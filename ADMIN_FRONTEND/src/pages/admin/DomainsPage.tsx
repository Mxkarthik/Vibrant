import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Check, Eye, Pencil, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react";
import {
  closeDomainLottery, createDomain, deleteDomain, enableDomainRead, getDomain, getDomainStatus,
  getDomains, openDomainLottery, recoverDomainPool, reviseDomainPool, setDomainsEnabled, updateDomain,
  type AdminDomain, type DomainRecoveryConfirmation, type DomainStatus
} from "../../api/domains";
import { getApiErrorMessage, getEvent, type EventRecord } from "../../api/events";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import PageHeader from "../../components/admin/PageHeader";
import ConfirmDialog from "../../components/events/ConfirmDialog";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";
import "./domains.css";

const limits = { title: 160, problemStatement: 20000, instructions: 10000 };
const empty = { title: "", problemStatement: "", instructions: "" };
const recoveryReasonLimit = 500;

const recoveryActions = {
  RESET_TO_DRAFT: {
    title: "Reset this lottery to private draft?",
    description: "This will close the current publication cycle, revoke future access to the complete problem bank, and restore domain editing. Historical versions will be preserved.",
    warning: "Only permitted when no team or individual has received a theme. Previously disclosed information cannot be recalled.",
    submitLabel: "Confirm Reset",
    notice: "Lottery reset to private draft. You can now edit or clear the draft domains."
  },
  CLEAR_DOMAINS: {
    title: "Delete all current draft domains?",
    description: "This removes every editable draft domain from the current event. Historical frozen versions remain preserved.",
    warning: "This deletion applies to every page of the draft.",
    submitLabel: "Delete Draft Domains",
    notice: "Draft domains cleared."
  }
};

const lifecycleActions = {
  open: {
    label: "Open Lottery",
    title: "Open the theme lottery?",
    description: "This action will freeze your current problem statements. The lottery is designed to let registered participants draw one random theme once the Participant Portal draw feature is available. The complete domain bank remains hidden.",
    warning: "While the pool is frozen, theme editing is locked. A closed private pool can be revised only before any theme has been assigned.",
    run: openDomainLottery,
    visibility: "PRIVATE",
    drawStatus: "OPEN",
    notice: "Lottery opened. The frozen domain bank remains private."
  },
  close: {
    label: "Close Lottery",
    title: "Close the theme lottery?",
    description: "Closing the lottery prevents new theme selections. All themes already assigned to teams remain permanently locked.",
    run: closeDomainLottery,
    drawStatus: "CLOSED",
    notice: "Lottery closed. The frozen pool and assignments are preserved."
  },
  reopen: {
    label: "Reopen Lottery",
    title: "Reopen the theme lottery?",
    description: "Reopening allows eligible teams that have not yet drawn to participate using the same frozen problem statements once the Participant Portal draw feature is available. Existing team assignments cannot change.",
    run: openDomainLottery,
    visibility: "PRIVATE",
    drawStatus: "OPEN",
    notice: "Lottery reopened with the existing frozen pool."
  },
  enableRead: {
    label: "Enable Read Domains",
    title: "Reveal all problem statements?",
    description: "All registered eligible participants will be permitted to read the complete frozen domain bank once the Participant Portal read feature is available. Their assigned themes will remain unchanged.",
    warning: "Read access can only be reset while the lottery remains unassigned. Previously disclosed information cannot be recalled.",
    run: enableDomainRead,
    visibility: "READABLE",
    drawStatus: "CLOSED",
    notice: "Read access enabled. The lottery is closed and assignments are preserved."
  },
  revise: {
    label: "Revise Domain Pool",
    confirmLabel: "Revise Pool",
    title: "Revise the frozen domain pool?",
    description: "No teams have received a theme yet. This will return the lottery to private editing so you can add or modify problem statements. The previous frozen version will remain preserved.",
    warning: "Once any team receives a theme, pool revision will no longer be available.",
    run: reviseDomainPool,
    visibility: "PRIVATE",
    drawStatus: "CLOSED",
    notice: "Domain pool returned to private draft. You can edit the problem statements and open a new version."
  }
} as const;

type LifecycleAction = keyof typeof lifecycleActions;

function isPrivateDraft(status: DomainStatus) {
  if (status.activeDraft !== undefined) return status.activeDraft;
  return status.visibility === "PRIVATE" && status.drawStatus === "CLOSED" &&
    !status.publishedAt && !status.readEnabledAt && status.frozenDomainCount === 0 &&
    (status.revisionPending === true ? status.poolVersion > 0 : status.poolVersion === 0);
}

function describeLottery(status: DomainStatus, total: number): {
  label: string;
  explanation: string;
  actions: LifecycleAction[];
} {
  const { allowedActions, enabled, visibility, drawStatus, frozenDomainCount } = status;
  const canClose = enabled && drawStatus === "OPEN" && allowedActions?.close === true;
  if (visibility === "READABLE") {
    return { label: "Read Enabled", explanation: "Read access applies to the complete frozen bank. Resetting to private draft revokes future access. Previously disclosed information cannot be recalled.", actions: [] };
  }
  if (visibility !== "PRIVATE") {
    return {
      label: "Legacy Public",
      explanation: canClose ? "Closing the lottery will preserve the event’s legacy visibility."
        : "This event uses legacy visibility. Opening the lottery and enabling read access are unavailable.",
      actions: canClose ? ["close"] : []
    };
  }
  if (!enabled) {
    return { label: "Disabled", explanation: "Enable Domains to prepare a private problem bank for this event.", actions: [] };
  }
  if (drawStatus === "OPEN") {
    return { label: "Open", explanation: "The frozen bank remains private. Close the lottery before enabling read access.", actions: canClose ? ["close"] : [] };
  }
  if (frozenDomainCount > 0 && status.publishedAt) {
    const actions: LifecycleAction[] = [];
    if (allowedActions?.reopen === true) actions.push("reopen");
    if (allowedActions?.enableRead === true) actions.push("enableRead");
    const canRevise = allowedActions?.resetToDraft === undefined && allowedActions?.revise === true && status.assignedEntryCount === 0;
    if (canRevise) actions.push("revise");
    return {
      label: "Closed · Frozen",
      explanation: canRevise
        ? "Revise the pool to edit statements while preserving this frozen version."
        : "The bank remains private and frozen.",
      actions
    };
  }
  const canOpen = allowedActions?.open === true && total > 0 && isPrivateDraft(status);
  return {
    label: "Private Draft",
    explanation: canOpen ? "Keep editing privately or open the lottery to freeze this draft and keep its contents private."
      : total === 0 ? "Add at least one problem statement before opening the lottery."
      : "The lottery cannot be opened in the event’s current state. Opening requires a published event.",
    actions: canOpen ? ["open"] : []
  };
}

function lifecycleError(error: unknown) {
  const response = isAxiosError<{ code?: string }>(error) ? error.response : undefined;
  const status = response?.status;
  if (response?.data?.code === "DOMAIN_COMMIT_UNKNOWN" || status === undefined) {
    return { message: "The change could not be confirmed. Check the current lottery status before submitting another action.", reconcile: true };
  }
  const fallback = "The lottery action failed.";
  switch (status) {
    case 400: return { message: getApiErrorMessage(error, "The lottery request was invalid."), reconcile: false };
    case 401: return { message: "Your admin session has expired. Sign in again to manage this lottery.", reconcile: true };
    case 403: return { message: "You do not have permission to change this lottery.", reconcile: true };
    case 404: return { message: "This event could not be found. Return to Events and check that it still exists.", reconcile: true };
    case 409: return { message: getApiErrorMessage(error, "The lottery state has changed. Check the current status."), reconcile: true };
    case 503: return { message: getApiErrorMessage(error, "Lottery coordination is temporarily unavailable. Try again later."), reconcile: false };
    default: return { message: getApiErrorMessage(error, fallback), reconcile: true };
  }
}

export default function DomainsPage() {
  const { id = "" } = useParams();
  return <EventDomains key={id} id={id}/>;
}

function EventDomains({ id }: { id: string }) {
  const [event, setEvent] = useState<EventRecord | null>(null); const [status, setStatus] = useState<DomainStatus | null>(null);
  const [domains, setDomains] = useState<AdminDomain[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [search, setSearch] = useState(""); const [formOpen, setFormOpen] = useState(false); const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null); const [viewing, setViewing] = useState<AdminDomain | null>(null); const [deleting, setDeleting] = useState<AdminDomain | null>(null);
  const [confirmation, setConfirmation] = useState<LifecycleAction | null>(null);
  const [recovery, setRecovery] = useState<{ confirmation: DomainRecoveryConfirmation; version: number } | null>(null);
  const lifecyclePending = useRef(false);
  const mounted = useRef(false);
  const refreshVersion = useRef(0);
  const formDialogRef = useAccessibleDialog(() => setFormOpen(false), busy, formOpen);
  const viewDialogRef = useAccessibleDialog(() => setViewing(null), false, Boolean(viewing));

  const refresh = useCallback(async () => {
    if (!mounted.current) return null;
    if (!/^[a-f\d]{24}$/i.test(id)) { setError("This event link is invalid. Return to Events and choose an event."); setLoading(false); return null; }
    const version = ++refreshVersion.current;
    const isCurrent = () => mounted.current && version === refreshVersion.current;
    setLoading(true);
    setError("");
    try {
      const [eventData, list, current] = await Promise.all([getEvent(id), getDomains(id, page, 50), getDomainStatus(id)]);
      if (!isCurrent()) return null;
      if (eventData.multiEventAccess?.enabled) {
        setEvent(null);
        setStatus(null);
        setError("Combo Pass parent events cannot manage a domain lottery.");
        return null;
      }
      setEvent(eventData); setDomains(list.domains); setTotal(list.total); setStatus(current);
      return current;
    } catch (e) {
      if (isCurrent()) {
        setStatus(null);
        setDomains([]);
        setTotal(0);
        setError(getApiErrorMessage(e, "Domain settings could not be loaded."));
      }
      return null;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [id, page]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const editable = Boolean(!loading && status?.enabled && isPrivateDraft(status));
  const lottery = status && describeLottery(status, total);
  const action = confirmation && lifecycleActions[confirmation];

  const runDomainAction = async (request: () => Promise<unknown>, matches: (current: DomainStatus) => boolean, success: string, afterSuccess?: () => void) => {
    if (busy || loading || lifecyclePending.current) return;
    lifecyclePending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request();
      const current = await refresh();
      if (!mounted.current) return;
      if (!current) {
        setError("The request succeeded, but the current lottery status could not be loaded. Refresh status to verify the change.");
      } else if (matches(current)) {
        setNotice(success);
        afterSuccess?.();
      } else {
        setError("The lottery status differs from the requested change. Review the current state before continuing.");
      }
    } catch (e) {
      const failure = lifecycleError(e);
      const current = failure.reconcile ? await refresh() : null;
      if (!mounted.current) return;
      setError(failure.reconcile && !current
        ? `${failure.message} The current status could not be refreshed.`
        : failure.message);
    } finally {
      lifecyclePending.current = false;
      if (mounted.current) {
        setConfirmation(null);
        setRecovery(null);
        setBusy(false);
      }
    }
  };

  const confirmLifecycle = async () => {
    if (!status || !confirmation || !action || !lottery?.actions.includes(confirmation)) return;
    const expectedVisibility = "visibility" in action ? action.visibility : status.visibility;
    const poolState = `${status.publishedAt ? "frozen" : "draft"}:${status.poolVersion}`;
    const expectedVersion = status.poolVersion + (confirmation === "open" ? 1 : 0);
    await runDomainAction(
      () => action.run(id, poolState),
      current => current.visibility === expectedVisibility && current.drawStatus === action.drawStatus &&
        current.poolVersion === expectedVersion && (confirmation === "revise"
          ? current.revisionPending && isPrivateDraft(current) : current.frozenDomainCount > 0),
      action.notice
    );
  };

  const startRecovery = (confirmation: DomainRecoveryConfirmation) => {
    if (typeof status?.coordinationVersion !== "number") return;
    setRecovery({ confirmation, version: status.coordinationVersion });
  };

  const confirmRecovery = async (reason: string) => {
    if (!status || !recovery) return;
    const { confirmation, version } = recovery;
    const resetting = confirmation === "RESET_TO_DRAFT";
    await runDomainAction(
      () => recoverDomainPool(id, version, confirmation, reason),
      current => isPrivateDraft(current) && current.poolVersion === status.poolVersion &&
        (resetting ? current.revisionPending : current.domainCount === 0),
      recoveryActions[confirmation].notice,
      () => { if (!resetting) { setPage(1); setSearch(""); } }
    );
  };
  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); return q ? domains.filter(d => `${d.title} ${d.problemStatement}`.toLowerCase().includes(q)) : domains; }, [domains, search]);
  const toggle = async () => { if (!status || busy) return; setBusy(true); setError(""); try { await setDomainsEnabled(id, !status.enabled); await refresh(); setNotice(`Domains ${status.enabled ? "disabled" : "enabled"}.`); } catch (e) { setError(getApiErrorMessage(e, "The setting was not changed.")); await refresh(); } finally { setBusy(false); } };
  const startEdit = async (d: AdminDomain) => { setBusy(true); try { const full = await getDomain(id, d._id); setEditing(d._id); setForm({ title: full.title, problemStatement: full.problemStatement, instructions: full.instructions || "" }); setFormOpen(true); } catch (e) { setError(getApiErrorMessage(e, "Could not load this statement.")); } finally { setBusy(false); } };
  const view = async (d: AdminDomain) => { setBusy(true); try { setViewing(await getDomain(id, d._id)); } catch (e) { setError(getApiErrorMessage(e, "Could not load this statement.")); } finally { setBusy(false); } };
  const submit = async (e: FormEvent) => { e.preventDefault(); const payload = { title: form.title.trim(), problemStatement: form.problemStatement.trim(), instructions: form.instructions.trim() }; if (!payload.title || !payload.problemStatement) return; setBusy(true); setError(""); try { if (editing) await updateDomain(id, editing, payload); else await createDomain(id, payload); setFormOpen(false); setNotice(editing ? "Problem statement updated." : "Problem statement added."); await refresh(); } catch (err) { setError(getApiErrorMessage(err, "Could not save this statement.")); } finally { setBusy(false); } };
  const remove = async () => { if (!deleting || busy) return; setBusy(true); try { await deleteDomain(id, deleting._id); setDeleting(null); setNotice("Problem statement deleted."); await refresh(); } catch (e) { setDeleting(null); setError(getApiErrorMessage(e, "Could not delete this statement.")); await refresh(); } finally { setBusy(false); } };

  if (loading && !event) return <div className="domain-page-state">Loading event domains…</div>;
  if (!event) return <div className="domain-page-state"><strong>Domains unavailable</strong><p>{error || "Event not found."}</p><Button variant="secondary" onClick={() => void refresh()}>Try again</Button></div>;
  return <div className="domains-page">
    <PageHeader title="Domains Management" description={event.name} action={<Link className="ui-button button-secondary" to="/admin/events"><ArrowLeft size={15}/> Back to Events</Link>} />
    <div className="domain-breadcrumb">EVENT MANAGEMENT / {event.name.toUpperCase()}</div>
    {error && <div className="domain-alert" role="alert"><span>{error}</span><div><button className="domain-refresh" disabled={busy || loading} onClick={() => void refresh()}>Refresh status</button><button onClick={() => setError("")} aria-label="Dismiss"><X size={16}/></button></div></div>}
    {notice && <div className="domain-notice" role="status"><Check size={15}/>{notice}</div>}
    <Card className="domain-panel">
      <section className="domain-config-row"><div><span className="domain-icon"><ShieldCheck size={17}/></span><div><h2>Enable Domains</h2><p>Allow this event to use the hackathon theme lottery. Enabling does not publish or open the draw.</p></div></div><button className={`domain-switch ${status?.enabled ? "on" : ""}`} type="button" role="switch" aria-checked={status?.enabled ?? false} aria-label="Enable Domains" disabled={!status || busy || Boolean(status.publishedAt)} onClick={() => void toggle()}><span/></button></section>
      {status && <section className="domain-status-grid" aria-label="Lottery status"><Status label="Feature" value={status.enabled ? "Enabled" : "Disabled"}/><Status label="Visibility" value={status.visibility === "READABLE" ? "Read Enabled" : status.visibility === "PUBLIC" ? "Legacy Public" : "Private"}/><Status label="Lottery" value={status.drawStatus === "OPEN" ? (status.visibility === "PRIVATE" ? "Open · Pool hidden" : "Open") : "Closed"}/><Status label="Frozen pool" value={status.frozenDomainCount ? `${status.frozenDomainCount} · v${status.poolVersion}` : "Not published"}/>{status.assignedEntryCount !== undefined && <Status label="Assigned entries" value={String(status.assignedEntryCount)}/ >}{status.readEnabledAt && <Status label="Read enabled" value={formatDate(status.readEnabledAt)}/>}</section>}
      <section className="domain-lottery" aria-labelledby="domain-lottery-heading" aria-busy={loading || (busy && Boolean(confirmation))}>
        <div className="domain-lottery-heading">
          <h2 id="domain-lottery-heading">Visibility &amp; Lottery Settings</h2>
          {lottery && <span className="domain-lottery-state">{lottery.label}</span>}
        </div>
        <p>{lottery?.explanation ?? (loading ? "Loading lottery status." : "Refresh status to manage the lottery.")}</p>
        {status && <dl className="domain-lottery-details">
          <div><dt>Domains</dt><dd>{total}</dd></div>
          {status.assignedEntryCount !== undefined && <div><dt>Assigned entries</dt><dd>{status.assignedEntryCount}</dd></div>}
          <div><dt>Frozen pool</dt><dd>{status.frozenDomainCount > 0
            ? `Version ${status.poolVersion} · ${status.frozenDomainCount} ${status.frozenDomainCount === 1 ? "domain" : "domains"}`
            : status.revisionPending ? `Version ${status.poolVersion} preserved · no active pool` : "Not published"}</dd></div>
        </dl>}
        {!!lottery?.actions.length && <div className="domain-lottery-actions">
          {lottery.actions.map((key, index) => <Button
            key={key}
            variant={index === 0 ? "primary" : "secondary"}
            disabled={busy || loading || Boolean(confirmation)}
            onClick={() => setConfirmation(key)}
          >{lifecycleActions[key].label}</Button>)}
        </div>}
      </section>
      {status?.allowedActions?.resetToDraft !== undefined && <section className="domain-lottery domain-administrative" aria-labelledby="domain-administrative-heading">
        <h2 id="domain-administrative-heading">Administrative Actions</h2>
        {status.assignedEntryCount ? <p>Existing theme assignments prevent a reset or bulk clear. Changing assigned themes would require a separate, audited reassignment workflow.</p>
          : <p>Reset a closed pool to restore private editing, or clear the current draft to start with an empty bank.</p>}
        <div className="domain-lottery-actions">
          <Button type="button" disabled={!status.allowedActions.resetToDraft || busy || loading} onClick={() => startRecovery("RESET_TO_DRAFT")}>Reset Lottery to Draft</Button>
          <Button type="button" disabled={!status.allowedActions.clearDraft || busy || loading} onClick={() => startRecovery("CLEAR_DOMAINS")}>Clear Draft Domains</Button>
        </div>
      </section>}
      <section className="domain-bank"><div className="domain-bank-heading"><div><h2>Problem Statements</h2><p>{total} {total === 1 ? "domain" : "domains"}</p></div><label className="domain-search"><Search size={15}/><input aria-label="Search loaded domains" placeholder="Search loaded domains" value={search} onChange={e => setSearch(e.target.value)}/></label></div>
        {loading ? <div className="domain-skeleton" aria-label="Loading domains"><i/><i/><i/></div> : domains.length === 0 ? <div className="domain-empty"><ShieldCheck size={22}/><h3>No problem statements yet</h3><p>Enable Domains to add private themes and complete problem statements.</p></div> : filtered.length === 0 ? <div className="domain-empty">No matches on this page.</div> : <div className="domain-list">{filtered.map(d => <article className="domain-row" key={d._id}><div className="domain-copy"><h3>{d.title}</h3><p>{d.problemStatement}</p><small>Updated {formatDate(d.updatedAt)}</small></div><span className={`domain-badge ${status?.publishedAt ? "frozen" : ""}`}>{status?.publishedAt ? "Frozen" : "Private"}</span><div className="domain-actions"><button disabled={busy || loading} onClick={() => void view(d)} aria-label={`View ${d.title}`}><Eye size={16}/></button><button disabled={!editable || busy} onClick={() => void startEdit(d)} aria-label={`Edit ${d.title}`}><Pencil size={16}/></button><button disabled={!editable || busy} onClick={() => setDeleting(d)} aria-label={`Delete ${d.title}`}><Trash2 size={16}/></button></div></article>)}</div>}
        {total > 50 && <div className="domain-pagination"><span>Page {page}; search covers loaded domains only.</span><Button variant="secondary" disabled={page <= 1 || loading || busy} onClick={() => setPage(p => p - 1)}>Previous</Button><Button variant="secondary" disabled={page * 50 >= total || loading || busy} onClick={() => setPage(p => p + 1)}>Next</Button></div>}
        <Button variant="secondary" className="domain-add" onClick={() => { setEditing(null); setForm(empty); setFormOpen(true); }} disabled={!editable || busy}><Plus size={16}/> Add New Domain</Button>
      </section>
    </Card>
    {recovery && <RecoveryDialog confirmation={recovery.confirmation} domainCount={status?.domainCount ?? total}
      busy={busy} onCancel={() => setRecovery(null)} onConfirm={reason => void confirmRecovery(reason)} />}
    {action && <div className="domain-lifecycle-confirm">
      <ConfirmDialog
        title={action.title}
        description={"warning" in action ? `${action.description}\n\n${action.warning}` : action.description}
        confirmLabel={"confirmLabel" in action ? action.confirmLabel : action.label}
        cancelLabel="Cancel"
        busy={busy}
        onConfirm={() => void confirmLifecycle()}
        onCancel={() => setConfirmation(null)}
      />
    </div>}
    {formOpen && <div className="domain-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setFormOpen(false); }}><section ref={formDialogRef} className="domain-modal" role="dialog" aria-modal="true" aria-labelledby="domain-modal-title"><header><div><small>{event.name}</small><h2 id="domain-modal-title">{editing ? "Edit Problem Statement" : "Add New Domain"}</h2></div><button onClick={() => setFormOpen(false)} disabled={busy} aria-label="Close"><X size={19}/></button></header><form onSubmit={submit}><Field label="Domain Title" required value={form.title} max={160} onChange={v => setForm(x => ({...x,title:v}))}/><Field label="Problem Statement" required value={form.problemStatement} max={20000} multiline onChange={v => setForm(x => ({...x,problemStatement:v}))}/><Field label="Instructions" value={form.instructions} max={10000} multiline onChange={v => setForm(x => ({...x,instructions:v}))}/><footer><Button variant="secondary" type="button" onClick={() => setFormOpen(false)} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" disabled={busy || !form.title.trim() || !form.problemStatement.trim() || form.title.trim().length > limits.title || form.problemStatement.trim().length > limits.problemStatement || form.instructions.trim().length > limits.instructions}>{busy ? "Saving…" : editing ? "Save changes" : "Add domain"}</Button></footer></form></section></div>}
    {viewing && <div className="domain-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setViewing(null); }}><section ref={viewDialogRef} className="domain-modal domain-view" role="dialog" aria-modal="true" aria-labelledby="domain-view-title"><header><div><small>{event.name}</small><h2 id="domain-view-title">{viewing.title}</h2></div><button onClick={() => setViewing(null)} aria-label="Close"><X size={19}/></button></header><div className="domain-view-copy"><h3>Problem statement</h3><p>{viewing.problemStatement}</p>{viewing.instructions && <><h3>Instructions</h3><p>{viewing.instructions}</p></>}<small>Created {formatDate(viewing.createdAt)} · Updated {formatDate(viewing.updatedAt)}</small></div><footer><Button variant="secondary" onClick={() => setViewing(null)}>Close</Button></footer></section></div>}
    {deleting && <ConfirmDialog title="Delete problem statement?" description={`“${deleting.title}” will be permanently deleted. This cannot be undone.`} confirmLabel="Delete domain" cancelLabel="Keep domain" busy={busy} onConfirm={() => void remove()} onCancel={() => setDeleting(null)}/>}
  </div>;
}
function RecoveryDialog({ confirmation, domainCount, busy, onCancel, onConfirm }: {
  confirmation: DomainRecoveryConfirmation;
  domainCount: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [phrase, setPhrase] = useState("");
  const [reason, setReason] = useState("");
  const dialogRef = useAccessibleDialog(onCancel, busy);
  const action = recoveryActions[confirmation];
  const resetting = confirmation === "RESET_TO_DRAFT";
  const canConfirm = phrase === confirmation && (!resetting || reason.trim().length > 0) && !busy;

  return <div className="domain-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
    <section ref={dialogRef} className="domain-modal domain-recovery-modal" role="dialog" aria-modal="true"
      aria-labelledby="domain-recovery-title" aria-describedby="domain-recovery-description">
      <header><h2 id="domain-recovery-title">{action.title}</h2></header>
      <form onSubmit={e => { e.preventDefault(); if (canConfirm) onConfirm(reason.trim()); }}>
        <p id="domain-recovery-description">{action.description}</p>
        <p className="domain-recovery-warning">{action.warning}{!resetting && ` Draft domains to delete: ${domainCount}.`}</p>
        <label className="domain-field">
          <span>Type <code>{confirmation}</code> to confirm</span>
          <input value={phrase} onChange={e => setPhrase(e.target.value)} autoComplete="off" disabled={busy} />
        </label>
        <label className="domain-field">
          <span>{resetting ? "Reason (required)" : "Reason (optional)"}</span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
            maxLength={recoveryReasonLimit} required={resetting} disabled={busy} />
        </label>
        <footer>
          <Button type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!canConfirm}>{busy ? "Working…" : action.submitLabel}</Button>
        </footer>
      </form>
    </section>
  </div>;
}
function Field({label,required=false,multiline=false,value,max,onChange}:{label:string;required?:boolean;multiline?:boolean;value:string;max:number;onChange:(v:string)=>void}) { const fieldId=label.toLowerCase().replaceAll(" ","-"); return <label className="domain-field" htmlFor={fieldId}><span>{label}{required && <b> *</b>}</span>{multiline?<textarea id={fieldId} required={required} value={value} maxLength={max} rows={label==="Problem Statement"?7:3} onChange={e=>onChange(e.target.value)}/>:<input id={fieldId} required={required} value={value} maxLength={max} onChange={e=>onChange(e.target.value)}/>}<small>{value.length.toLocaleString()} / {max.toLocaleString()}</small></label>; }
function Status({label,value}:{label:string;value:string}) { return <div className="domain-status"><small>{label}</small><strong>{value}</strong></div>; }
function formatDate(value:string) { const d=new Date(value); return Number.isNaN(d.getTime())?"—":new Intl.DateTimeFormat("en-IN",{dateStyle:"medium",timeStyle:"short"}).format(d); }
