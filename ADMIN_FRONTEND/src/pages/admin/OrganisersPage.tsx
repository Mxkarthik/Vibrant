import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Mail, Plus, RefreshCw, Search, ShieldCheck, UserRoundCog, X } from "lucide-react";
import { getApiErrorMessage } from "../../api/events";
import { getEligibleParticipants, getOrganisers, updateOrganiserRole, type AdminUserRecord } from "../../api/organisers";
import { useAuth } from "../../auth/AuthContext";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import PageHeader from "../../components/admin/PageHeader";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";

type PendingChange = { user: AdminUserRecord; role: "ORGANISER" | "PARTICIPANT" };
const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function OrganisersPage() {
  const { user: currentUser } = useAuth();
  const [organisers, setOrganisers] = useState<AdminUserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [directorySearch, setDirectorySearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [participantSearchInput, setParticipantSearchInput] = useState("");
  const [participantSearch, setParticipantSearch] = useState("");
  const [participantPage, setParticipantPage] = useState(1);
  const [participants, setParticipants] = useState<AdminUserRecord[]>([]);
  const [participantTotal, setParticipantTotal] = useState(0);
  const [participantPages, setParticipantPages] = useState(0);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [participantsError, setParticipantsError] = useState<string | null>(null);
  const [selectedParticipant, setSelectedParticipant] = useState<AdminUserRecord | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const [brokenPictures, setBrokenPictures] = useState<string[]>([]);

  const loadOrganisers = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setLoadError(null);
    try { const result = await getOrganisers(); setOrganisers(result.organisers); }
    catch (error) { setLoadError(getApiErrorMessage(error, "Organisers could not be loaded.")); }
    finally { if (showLoading) setLoading(false); }
  }, []);
  useEffect(() => { void loadOrganisers(); }, [loadOrganisers]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { setParticipantSearch(participantSearchInput.trim()); setParticipantPage(1); }, 250);
    return () => window.clearTimeout(timeout);
  }, [participantSearchInput]);

  const loadParticipants = useCallback(async () => {
    if (!pickerOpen) return;
    setParticipantsLoading(true); setParticipantsError(null);
    try {
      const result = await getEligibleParticipants(participantSearch, participantPage, 10);
      setParticipants(result.users); setParticipantTotal(result.pagination.total); setParticipantPages(result.pagination.totalPages);
    } catch (error) { setParticipantsError(getApiErrorMessage(error, "Participant accounts could not be loaded.")); }
    finally { setParticipantsLoading(false); }
  }, [pickerOpen, participantSearch, participantPage]);
  useEffect(() => { void loadParticipants(); }, [loadParticipants]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !working) { setPickerOpen(false); setPendingChange(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [working]);

  const filteredOrganisers = useMemo(() => {
    const term = directorySearch.trim().toLowerCase();
    return organisers.filter(organiser => {
      const matchesText = !term || organiser.name.toLowerCase().includes(term) || organiser.email.toLowerCase().includes(term);
      const matchesStatus = accountFilter === "ALL" || (accountFilter === "ACTIVE" ? organiser.isActive : !organiser.isActive);
      return matchesText && matchesStatus;
    });
  }, [organisers, directorySearch, accountFilter]);
  const pageCount = Math.ceil(filteredOrganisers.length / pageSize);
  const visibleOrganisers = filteredOrganisers.slice((page - 1) * pageSize, page * pageSize);

  const requestPromote = () => {
    if (!selectedParticipant || !selectedParticipant.isActive) return;
    setPendingChange({ user: selectedParticipant, role: "ORGANISER" });
    setPickerOpen(false);
  };

  const performRoleChange = async () => {
    if (!pendingChange || working) return;
    const { user, role } = pendingChange;
    if (user.email.toLowerCase() === currentUser?.email.toLowerCase()) {
      setNotice({ message: "You cannot change your own administrator role.", error: true });
      return;
    }
    setWorking(true); setNotice(null);
    try {
      const response = await updateOrganiserRole(user.email, role);
      if (role === "ORGANISER") {
        setOrganisers(current => current.some(item => item.email === user.email)
          ? current.map(item => item.email === user.email ? { ...item, role } : item)
          : [{ ...user, role }, ...current]);
      } else {
        setOrganisers(current => current.filter(item => item.email !== user.email));
      }
      setPendingChange(null); setSelectedParticipant(null);
      setNotice({ message: response.message });
      await loadOrganisers(false);
      if (pickerOpen) await loadParticipants();
    } catch (error) {
      setNotice({ message: getApiErrorMessage(error, "The user role could not be updated."), error: true });
    } finally { setWorking(false); }
  };

  const openPicker = () => {
    setParticipantSearchInput(""); setParticipantSearch(""); setParticipantPage(1); setSelectedParticipant(null); setParticipantsError(null); setPickerOpen(true);
  };

  return <>
    <PageHeader title="Organisers" description="Manage global organiser accounts across the VIBRANT platform." action={<div className="organiser-header-actions"><Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void loadOrganisers()} disabled={loading}>Refresh</Button><Button variant="primary" icon={<Plus size={15} />} onClick={openPicker}>Promote participant</Button></div>} />
    {notice && <div className={`organiser-notice ${notice.error ? "is-error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.error ? <span>!</span> : <ShieldCheck size={15} />}{notice.message}<button onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={14} /></button></div>}
    <Card className="organiser-card">
      <div className="organiser-toolbar"><label className="organiser-search"><Search size={15} /><input value={directorySearch} onChange={event => { setDirectorySearch(event.target.value); setPage(1); }} placeholder="Search organisers by name or email" aria-label="Search organisers" /></label><select aria-label="Filter account status" value={accountFilter} onChange={event => { setAccountFilter(event.target.value as typeof accountFilter); setPage(1); }}><option value="ALL">All account statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
      {loadError ? <div className="organiser-state"><h2>Could not load organisers</h2><p>{loadError}</p><Button variant="secondary" onClick={() => void loadOrganisers()}>Try again</Button></div>
        : loading ? <OrganiserSkeleton />
        : !filteredOrganisers.length ? <div className="organiser-state"><span className="organiser-state-icon"><UserRoundCog size={20} /></span><h2>{organisers.length ? "No matching organisers" : "No organisers yet"}</h2><p>{organisers.length ? "Change the search or account status filter." : "Promote a registered participant to add the first organiser."}</p>{!organisers.length && <Button variant="primary" icon={<Plus size={14} />} onClick={openPicker}>Promote participant</Button>}</div>
        : <>
          <div className="organiser-table-wrap"><table className="organiser-table"><thead><tr><th>Organiser</th><th>Role</th><th>Account status</th><th>Added</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visibleOrganisers.map(organiser => <tr key={organiser._id}>
            <td><div className="organiser-identity">{organiser.profilePicture && !brokenPictures.includes(organiser._id) ? <img src={organiser.profilePicture} alt="" onError={() => setBrokenPictures(current => [...current, organiser._id])} /> : <span className="organiser-avatar-fallback">{organiser.name.trim().charAt(0).toUpperCase() || "O"}</span>}<div><strong>{organiser.name}</strong><small><Mail size={12} />{organiser.email}</small></div></div></td>
            <td><span className="organiser-role"><UserRoundCog size={13} />Organiser</span></td><td><AccountStatus active={organiser.isActive} /></td><td>{formatDate(organiser.createdAt)}</td>
            <td><Button variant="secondary" className="organiser-demote-button" onClick={() => setPendingChange({ user: organiser, role: "PARTICIPANT" })} disabled={!organiser.isActive || organiser.email.toLowerCase() === currentUser?.email.toLowerCase()} title={!organiser.isActive ? "Inactive accounts cannot be changed" : undefined}>Demote</Button></td>
          </tr>)}</tbody></table></div>
          <div className="organiser-pagination"><span>{filteredOrganisers.length} organiser{filteredOrganisers.length === 1 ? "" : "s"}</span><div><label>Rows <select aria-label="Rows per page" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label><Button variant="secondary" icon={<ChevronLeft size={14} />} onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page <= 1}>Previous</Button><span>Page {page} of {Math.max(pageCount, 1)}</span><Button variant="secondary" onClick={() => setPage(current => current + 1)} disabled={page >= pageCount}>Next <ChevronRight size={14} /></Button></div></div>
        </>}
    </Card>
    {pickerOpen && <ParticipantPicker search={participantSearchInput} onSearch={value => setParticipantSearchInput(value)} page={participantPage} onPage={setParticipantPage} total={participantTotal} pages={participantPages} users={participants} selected={selectedParticipant?._id ?? ""} loading={participantsLoading} error={participantsError} onRetry={() => void loadParticipants()} onSelect={setSelectedParticipant} onPromote={requestPromote} onClose={() => setPickerOpen(false)} />}
    {pendingChange && <RoleChangeConfirmation change={pendingChange} busy={working} onCancel={() => { if (!working) setPendingChange(null); }} onConfirm={() => void performRoleChange()} />}
  </>;
}

function ParticipantPicker({ search, onSearch, page, onPage, total, pages, users, selected, loading, error, onRetry, onSelect, onPromote, onClose }: { search: string; onSearch: (value: string) => void; page: number; onPage: (page: number) => void; total: number; pages: number; users: AdminUserRecord[]; selected: string; loading: boolean; error: string | null; onRetry: () => void; onSelect: (user: AdminUserRecord) => void; onPromote: () => void; onClose: () => void }) {
  const dialogRef = useAccessibleDialog(onClose);
  return <div className="organiser-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className="participant-picker" role="dialog" aria-modal="true" aria-labelledby="participant-picker-title">
    <header><div><p>GLOBAL ROLE MANAGEMENT</p><h2 id="participant-picker-title">Promote a participant</h2></div><button className="organiser-modal-close" onClick={onClose} aria-label="Close participant selector"><X size={18} /></button></header>
    <p className="participant-picker-copy">Select an active registered participant. Organiser access applies across the platform.</p>
    <label className="organiser-search picker-search"><Search size={15} /><input value={search} onChange={event => onSearch(event.target.value)} placeholder="Search name or email" aria-label="Search eligible participants" /></label>
    {error ? <div className="organiser-state compact"><p>{error}</p><Button variant="secondary" onClick={onRetry}>Try again</Button></div> : loading ? <OrganiserSkeleton compact /> : !users.length ? <div className="organiser-state compact"><p>{search ? "No participants match this search." : "No participant accounts are available."}</p></div> : <div className="participant-picker-list">{users.map(candidate => <button key={candidate._id} className={`participant-picker-row ${selected === candidate._id ? "selected" : ""}`} onClick={() => candidate.isActive && onSelect(candidate)} disabled={!candidate.isActive}><span className="organiser-avatar-fallback">{candidate.name.trim().charAt(0).toUpperCase() || "P"}</span><span className="participant-picker-user"><strong>{candidate.name}</strong><small>{candidate.email}</small></span><span className={`account-status ${candidate.isActive ? "active" : "inactive"}`}>{candidate.isActive ? "Active" : "Inactive"}</span></button>)}</div>}
    <div className="participant-picker-footer"><span>{total} participant{total === 1 ? "" : "s"} · Page {page} of {Math.max(pages, 1)}</span><div><Button variant="secondary" icon={<ChevronLeft size={14} />} onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1 || loading}>Previous</Button><Button variant="secondary" onClick={() => onPage(page + 1)} disabled={page >= pages || loading}>Next <ChevronRight size={14} /></Button></div></div>
    <div className="participant-picker-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={onPromote} disabled={!users.some(user => user._id === selected && user.isActive)}>Continue to confirmation</Button></div>
  </section></div>;
}

function RoleChangeConfirmation({ change, busy, onCancel, onConfirm }: { change: PendingChange; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const promoting = change.role === "ORGANISER";
  const dialogRef = useAccessibleDialog(onCancel, busy);
  return <div className="organiser-modal-backdrop top-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}><section ref={dialogRef} className="role-change-dialog" role="alertdialog" aria-modal="true" aria-labelledby="role-change-title" aria-describedby="role-change-description"><span className="role-change-icon"><ShieldCheck size={18} /></span><h2 id="role-change-title">{promoting ? "Promote to organiser?" : "Demote organiser?"}</h2><p id="role-change-description">{promoting ? <>{change.user.name} will get global organiser access for VIBRANT events.</> : <>{change.user.name} will lose organiser access and return to the participant role.</>}</p><div className="role-change-user"><strong>{change.user.name}</strong><small>{change.user.email}</small></div><div className="role-change-actions"><Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button><Button variant="primary" className={promoting ? "promote-confirm-button" : "demote-confirm-button"} onClick={onConfirm} disabled={busy}>{busy ? "Updating…" : promoting ? "Promote organiser" : "Demote to participant"}</Button></div></section></div>;
}

function AccountStatus({ active }: { active: boolean }) { return <span className={`account-status ${active ? "active" : "inactive"}`}><i />{active ? "Active" : "Inactive"}</span>; }
function OrganiserSkeleton({ compact = false }: { compact?: boolean }) { return <div className={`organiser-skeleton ${compact ? "compact" : ""}`} aria-label="Loading organisers">{[0, 1, 2, 3, 4].map(item => <span key={item} />)}</div>; }
function formatDate(value?: string) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date); }
