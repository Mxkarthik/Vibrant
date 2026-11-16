import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, CheckCircle2, ChevronLeft, ChevronRight, Download, Eye, FileBadge, RefreshCw, Search, ShieldCheck, Users, X } from "lucide-react";
import { getApiErrorMessage } from "../../api/events";
import type { EventRecord } from "../../api/events";
import { downloadCertificate, getCertificateEvents, getEventCertificates, issueCertificateForRegistration, issueCertificatesForEvent, type CertificateRecord, type CertificateStatusFilter } from "../../api/certificates";
import CertificatePreview from "../../components/certificates/CertificatePreview";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import PageHeader from "../../components/admin/PageHeader";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";

const numberFormat = new Intl.NumberFormat("en-IN");
const initialQuery = { page: 1, limit: 20, search: "", status: "ALL" as CertificateStatusFilter };

export default function CertificatesPage() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [eventId, setEventId] = useState("");
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState(initialQuery);
  const [data, setData] = useState<Awaited<ReturnType<typeof getEventCertificates>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; error?: boolean; details?: string[] } | null>(null);
  const [preview, setPreview] = useState<CertificateRecord | null>(null);
  const [issueIntent, setIssueIntent] = useState<{ kind: "bulk" } | { kind: "single"; record: CertificateRecord } | null>(null);
  const [working, setWorking] = useState(false);
  const selectedEvent = useMemo(() => events.find(event => event._id === eventId), [events, eventId]);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true); setEventsError(null);
    try {
      const result = await getCertificateEvents();
      setEvents(result);
      setEventId(current => current || result.find(event => event.status === "COMPLETED")?._id || result[0]?._id || "");
    } catch (requestError) { setEventsError(getApiErrorMessage(requestError, "Events could not be loaded.")); }
    finally { setEventsLoading(false); }
  }, []);
  useEffect(() => { void loadEvents(); }, [loadEvents]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(current => ({ ...current, search: searchInput.trim(), page: 1 })), 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const loadCertificates = useCallback(async () => {
    if (!eventId) { setData(null); setError(null); setLoading(false); return; }
    setLoading(true); setError(null);
    try { setData(await getEventCertificates(eventId, query)); }
    catch (requestError) { setError(getApiErrorMessage(requestError, "Certificate records could not be loaded.")); }
    finally { setLoading(false); }
  }, [eventId, query]);
  useEffect(() => { void loadCertificates(); }, [loadCertificates]);

  const issue = async () => {
    if (!issueIntent || working || !eventId) return;
    setWorking(true); setNotice(null);
    try {
      if (issueIntent.kind === "bulk") {
        const result = await issueCertificatesForEvent(eventId);
        const skipped = result.skipped.map(item => `${item.participant}: ${item.reason}`);
        const message = `${numberFormat.format(result.issuedCount)} certificate${result.issuedCount === 1 ? "" : "s"} issued. ${numberFormat.format(result.skippedCount)} skipped from ${numberFormat.format(result.totalCandidates)} unissued records.`;
        setNotice({ message, error: result.skippedCount > 0, details: skipped.slice(0, 5) });
      } else {
        const result = await issueCertificateForRegistration(issueIntent.record.registrationId);
        setNotice({ message: `${result.message} Certificate ID: ${result.certificate.certificateId}` });
      }
      setIssueIntent(null);
      await loadCertificates();
    } catch (requestError) {
      setNotice({ message: getApiErrorMessage(requestError, "Certificate issuance failed."), error: true });
    } finally { setWorking(false); }
  };

  const download = async (record: CertificateRecord) => {
    if (!record.certificateId) return;
    setExportingId(record.registrationId); setNotice(null);
    try {
      const response = await downloadCertificate(record.certificateId);
      const objectUrl = URL.createObjectURL(response.data);
      const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.download = `${record.certificateId}.pdf`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setNotice({ message: `Certificate for ${record.participantName} downloaded.` });
    } catch (requestError) {
      const responseData = (requestError as { response?: { data?: Blob } })?.response?.data;
      let message = getApiErrorMessage(requestError, "Certificate download failed.");
      if (responseData instanceof Blob) { try { const body = JSON.parse(await responseData.text()); if (body.message) message = body.message; } catch { /* Keep fallback. */ } }
      setNotice({ message, error: true });
    } finally { setExportingId(null); }
  };

  const refresh = async () => { await Promise.all([loadEvents(), loadCertificates()]); };
  const changeEvent = (id: string) => { setEventId(id); setQuery(initialQuery); setSearchInput(""); setNotice(null); setPreview(null); };
  const canBulkIssue = selectedEvent?.status === "COMPLETED" && (data?.summary.pending ?? 0) > 0;

  return <>
    <PageHeader title="Certificates" description="Review eligibility, issue participation certificates, and manage downloads." action={<div className="certificate-page-actions"><Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void refresh()} disabled={loading || eventsLoading}>Refresh</Button><Button variant="primary" icon={<Award size={15} />} onClick={() => setIssueIntent({ kind: "bulk" })} disabled={!canBulkIssue || working}>{working && issueIntent?.kind === "bulk" ? "Issuing…" : "Issue eligible certificates"}</Button></div>} />
    {notice && <div className={`certificate-notice ${notice.error ? "is-error" : ""}`} role={notice.error ? "alert" : "status"}><span>{notice.error ? "!" : <CheckCircle2 size={15} />}</span><div><p>{notice.message}</p>{notice.details?.length ? <ul>{notice.details.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : null}{notice.details && notice.details.length > 5 && <small>And {notice.details.length - 5} more skipped records.</small>}</div><button onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={14} /></button></div>}
    {eventsError ? <Card className="certificate-state"><h2>Events could not be loaded</h2><p>{eventsError}</p><Button variant="secondary" onClick={() => void loadEvents()}>Try again</Button></Card> : <>
      <Card className="certificate-event-picker"><label><span>Selected event</span><select aria-label="Select certificate event" value={eventId} disabled={eventsLoading || !events.length} onChange={event => changeEvent(event.target.value)}><option value="">{eventsLoading ? "Loading events…" : events.length ? "Select an event" : "No events available"}</option>{events.map(event => <option key={event._id} value={event._id}>{event.name} · {titleCase(event.status)}</option>)}</select></label>{selectedEvent && <div className={`certificate-event-state state-${selectedEvent.status.toLowerCase()}`}>{titleCase(selectedEvent.status)}</div>}</Card>
      {!eventId && !eventsLoading ? <Card className="certificate-state"><span className="certificate-state-icon"><FileBadge size={19} /></span><h2>No events available</h2><p>Create an event before managing participation certificates.</p></Card> : eventId && <>
        {error ? <div className="certificate-error" role="alert"><div><strong>Could not load certificate records</strong><p>{error}</p></div><Button variant="secondary" onClick={() => void loadCertificates()}>Try again</Button></div> : loading && !data ? <CertificateSummarySkeleton /> : data && <>
          {selectedEvent?.status !== "COMPLETED" && <div className="certificate-eligibility-note" role="status">Certificates can be issued only after an event is completed. This event is currently {titleCase(selectedEvent?.status || "unknown").toLowerCase()}.</div>}
          <div className="certificate-summary-grid">
            <SummaryCard label="Eligible participants" value={data.summary.eligible} icon={<Users size={16} />} />
            <SummaryCard label="Certificates issued" value={data.summary.issued} icon={<CheckCircle2 size={16} />} />
            <SummaryCard label="Pending issuance" value={data.summary.pending} icon={<Award size={16} />} />
            <Card className="certificate-progress-card"><div><small>Issuance progress</small><strong>{data.summary.issuancePercentage.toFixed(1)}%</strong></div><div className="certificate-progress-track"><span style={{ width: `${Math.max(0, Math.min(100, data.summary.issuancePercentage))}%` }} /></div><small>{numberFormat.format(Math.max(0, data.summary.eligible - data.summary.pending))} of {numberFormat.format(data.summary.eligible)} eligible</small></Card>
          </div>
        </>}
        <Card className="certificate-record-card">
          <div className="certificate-toolbar"><div><h2>Certificate records</h2><p>{data ? `${numberFormat.format(data.pagination.total)} registration records for ${data.event.name}` : "Participant certificate eligibility and issuance status"}</p></div><div className="certificate-filters"><label className="certificate-search"><Search size={14} /><input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Search name, email or certificate ID" aria-label="Search certificate records" /></label><select aria-label="Filter certificate status" value={query.status} onChange={event => setQuery(current => ({ ...current, status: event.target.value as CertificateStatusFilter, page: 1 }))}><option value="ALL">All records</option><option value="PENDING">Eligible · pending</option><option value="ISSUED">Issued</option><option value="INELIGIBLE">Ineligible</option></select></div></div>
          {error ? <div className="certificate-state compact"><p>{error}</p><Button variant="secondary" onClick={() => void loadCertificates()}>Try again</Button></div>
            : loading ? <CertificateTableSkeleton />
            : !data?.certificates.length ? <div className="certificate-state compact"><span className="certificate-state-icon"><FileBadge size={18} /></span><h2>{query.search || query.status !== "ALL" ? "No matching records" : "No certificate records"}</h2><p>{query.search || query.status !== "ALL" ? "Change the search or issuance status filter." : "Registrations for this event will appear here."}</p></div>
            : <>
              <div className="certificate-table-wrap"><table className="certificate-table"><thead><tr><th>Participant</th><th>Event date</th><th>Eligibility</th><th>Certificate ID</th><th>Issued</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{data.certificates.map(record => <tr key={record.registrationId}>
                <td><div className="certificate-person"><strong>{record.participantName}</strong><small>{record.email || "Email unavailable"}</small>{record.teamName && <small>{record.teamName}{record.isTeamLeader ? " · Team leader" : " · Team member"}</small>}</div></td>
                <td>{formatDate(data.event.startDate)}</td><td><CertificateStatus record={record} /></td><td><code>{record.certificateId || "—"}</code></td><td>{record.issuedAt ? formatDate(record.issuedAt) : "—"}</td>
                <td><div className="certificate-row-actions">{(record.isEligible || record.isIssued) && <Button variant="secondary" icon={<Eye size={13} />} onClick={() => setPreview(record)}>Preview</Button>}{record.isEligible && !record.isIssued && <Button variant="secondary" icon={<Award size={13} />} onClick={() => setIssueIntent({ kind: "single", record })} disabled={working}>Issue</Button>}{record.isIssued && record.registrationStatus === "REGISTERED" && <Button variant="secondary" icon={<Download size={13} />} onClick={() => void download(record)} disabled={exportingId === record.registrationId}>{exportingId === record.registrationId ? "Preparing…" : "Download"}</Button>}</div></td>
              </tr>)}</tbody></table></div>
              <div className="certificate-pagination"><span>{numberFormat.format(data.pagination.total)} records · Page {query.page} of {Math.max(1, data.pagination.totalPages)}</span><div><label>Rows <select aria-label="Rows per page" value={query.limit} onChange={event => setQuery(current => ({ ...current, limit: Number(event.target.value), page: 1 }))}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label><Button variant="secondary" icon={<ChevronLeft size={14} />} onClick={() => setQuery(current => ({ ...current, page: Math.max(1, current.page - 1) }))} disabled={query.page <= 1 || loading}>Previous</Button><Button variant="secondary" onClick={() => setQuery(current => ({ ...current, page: current.page + 1 }))} disabled={query.page >= data.pagination.totalPages || loading}>Next <ChevronRight size={14} /></Button></div></div>
            </>}
        </Card>
      </>}
    </>}
    {preview && data && <CertificatePreview participantName={preview.participantName} eventName={data.event.name} eventStartDate={data.event.startDate} certificateId={preview.certificateId} issuedAt={preview.issuedAt} onClose={() => setPreview(null)} />}
    {issueIntent && <IssueConfirmation kind={issueIntent.kind} record={issueIntent.kind === "single" ? issueIntent.record : undefined} pendingCount={data?.summary.pending ?? 0} busy={working} onCancel={() => { if (!working) setIssueIntent(null); }} onConfirm={() => void issue()} />}
  </>;
}

function CertificateStatus({ record }: { record: CertificateRecord }) { if (record.isIssued) return <span className="certificate-status issued">Issued</span>; if (record.isEligible) return <span className="certificate-status pending">Eligible · pending</span>; return <span className="certificate-status ineligible" title={record.eligibilityReason || "Not eligible"}>Ineligible{record.eligibilityReason ? <small>{record.eligibilityReason}</small> : null}</span>; }
function SummaryCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) { return <Card className="certificate-summary-card"><span>{icon}</span><div><small>{label}</small><strong>{numberFormat.format(value)}</strong></div></Card>; }
function CertificateSummarySkeleton() { return <div className="certificate-summary-grid">{[0, 1, 2, 3].map(item => <Card key={item} className="certificate-summary-skeleton"><span /><span /></Card>)}</div>; }
function CertificateTableSkeleton() { return <div className="certificate-table-skeleton" aria-label="Loading certificate records">{[0, 1, 2, 3, 4].map(item => <span key={item} />)}</div>; }
function IssueConfirmation({ kind, record, pendingCount, busy, onCancel, onConfirm }: { kind: "bulk" | "single"; record?: CertificateRecord; pendingCount: number; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const isBulk = kind === "bulk";
  const dialogRef = useAccessibleDialog(onCancel, busy);
  return <div className="certificate-confirm-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}><section ref={dialogRef} className="certificate-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="certificate-confirm-title" aria-describedby="certificate-confirm-copy"><span className="certificate-confirm-icon"><ShieldCheck size={18} /></span><h2 id="certificate-confirm-title">{isBulk ? "Issue eligible certificates?" : "Issue this certificate?"}</h2><p id="certificate-confirm-copy">{isBulk ? `This will issue certificates to up to ${numberFormat.format(pendingCount)} eligible participants. Ineligible records will be skipped and reported.` : `${record?.participantName} will receive an individual participation certificate.`}</p><div className="certificate-confirm-actions"><Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button><Button variant="primary" onClick={onConfirm} disabled={busy}>{busy ? "Issuing…" : isBulk ? "Issue certificates" : "Issue certificate"}</Button></div></section></div>;
}
function titleCase(value: string) { return value.toLowerCase().replace(/\b\w/g, char => char.toUpperCase()); }
function formatDate(value?: string | null) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date); }
