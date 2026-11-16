import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, CreditCard, Eye, FileBadge, RefreshCw, Search, ShieldCheck, Users, X } from "lucide-react";
import { getAdminDashboard, type AdminDashboardData } from "../../api/adminDashboard";
import { getApiErrorMessage } from "../../api/events";
import { getIndividualPayments, getTeamPayments, updateIndividualPayment, updateTeamPayment, type IndividualPaymentRecord, type PaymentDecision, type PaymentListParams, type PaymentStatusFilter, type TeamPaymentRecord } from "../../api/payments";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import PageHeader from "../../components/admin/PageHeader";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";

type PaymentType = "individual" | "team";
interface PaymentRecord {
  id: string;
  type: PaymentType;
  title: string;
  subtitle: string;
  email?: string;
  mobile?: string;
  college?: string;
  department?: string;
  memberCount?: number;
  event?: { name?: string; category?: string; startDate?: string } | null;
  method: string;
  status: string;
  proofUrl?: string | null;
  createdAt?: string;
  teamStatus?: string;
}

const numberFormat = new Intl.NumberFormat("en-IN");
const initialParams: PaymentListParams = { page: 1, limit: 20, search: "", status: "PENDING" };

export default function PaymentsPage() {
  const [type, setType] = useState<PaymentType>("individual");
  const [params, setParams] = useState(initialParams);
  const [searchInput, setSearchInput] = useState("");
  const [records, setRecords] = useState<PaymentRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AdminDashboardData["payments"] | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PaymentRecord | null>(null);
  const [decision, setDecision] = useState<PaymentDecision | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setSummaryError(null);
    try { const dashboard = await getAdminDashboard(); setSummary(dashboard.payments); }
    catch (requestError) { setSummaryError(getApiErrorMessage(requestError, "Payment summary could not be loaded.")); }
  }, []);

  const loadPayments = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = type === "individual" ? await getIndividualPayments(params) : await getTeamPayments(params);
      const mapped = type === "individual"
        ? (response.payments as IndividualPaymentRecord[]).map(mapIndividualPayment)
        : (response.payments as TeamPaymentRecord[]).map(mapTeamPayment);
      setRecords(mapped); setTotal(response.pagination.total); setTotalPages(response.pagination.totalPages);
    } catch (requestError) { setError(getApiErrorMessage(requestError, "Payment records could not be loaded.")); }
    finally { setLoading(false); }
  }, [type, params]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { void loadPayments(); }, [loadPayments]);
  useEffect(() => {
    const timeout = window.setTimeout(() => setParams(current => ({ ...current, search: searchInput.trim(), page: 1 })), 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setProofPreview(null); if (!working) setDecision(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [working]);

  const refreshAll = async () => { await Promise.all([loadPayments(), loadSummary()]); };
  const changeTab = (next: PaymentType) => { setType(next); setParams(initialParams); setSearchInput(""); setSelected(null); setNotice(null); };
  const setStatus = (status: PaymentStatusFilter) => setParams(current => ({ ...current, status, page: 1 }));

  const submitDecision = async () => {
    if (!selected || !decision || selected.status !== "PENDING") return;
    setWorking(true);
    try {
      const result = selected.type === "individual"
        ? await updateIndividualPayment(selected.id, decision)
        : await updateTeamPayment(selected.id, decision);
      setNotice({ message: result.message, error: false });
      setDecision(null);
      setSelected(current => current?.id === selected.id ? { ...current, status: decision } : current);
      await Promise.all([loadPayments(), loadSummary()]);
    } catch (requestError) {
      setNotice({ message: getApiErrorMessage(requestError, "Payment status could not be updated."), error: true });
    } finally { setWorking(false); }
  };

  return <>
    <PageHeader title="Payments" description="Review individual and shared team payment submissions." action={<Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void refreshAll()} disabled={loading}>Refresh</Button>} />
    {notice && <div className={`payment-notice ${notice.error ? "is-error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.error ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}{notice.message}<button onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={14} /></button></div>}
    <div className="payment-summary-grid">
      <SummaryCard title="Pending individual" value={summary?.pendingIndividual} loading={!summary && !summaryError} error={summaryError} icon={<Clock3 size={17} />} tone="warning" />
      <SummaryCard title="Pending team" value={summary?.pendingTeams} loading={!summary && !summaryError} error={summaryError} icon={<Users size={17} />} tone="warning" />
      <SummaryCard title="Verified individual" value={summary?.verifiedIndividual} loading={!summary && !summaryError} error={summaryError} icon={<ShieldCheck size={17} />} tone="success" />
      <SummaryCard title="Verified team" value={summary?.verifiedTeams} loading={!summary && !summaryError} error={summaryError} icon={<CheckCircle2 size={17} />} tone="success" />
    </div>
    {summaryError && <div className="payment-summary-error" role="alert">{summaryError} <button onClick={() => void loadSummary()}>Retry</button></div>}
    <Card className="payment-card">
      <div className="payment-tabs" role="tablist" aria-label="Payment type">
        <button role="tab" aria-selected={type === "individual"} className={type === "individual" ? "active" : ""} onClick={() => changeTab("individual")}><CreditCard size={15} /> Individual <span>{summary ? numberFormat.format(summary.pendingIndividual) : "—"}</span></button>
        <button role="tab" aria-selected={type === "team"} className={type === "team" ? "active" : ""} onClick={() => changeTab("team")}><Users size={15} /> Teams <span>{summary ? numberFormat.format(summary.pendingTeams) : "—"}</span></button>
      </div>
      <div className="payment-toolbar">
        <label className="payment-search"><Search size={15} /><input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder={type === "individual" ? "Search participant, email, event…" : "Search team, leader, event…"} aria-label="Search payments" /></label>
        <select aria-label="Filter payment status" value={params.status} onChange={event => setStatus(event.target.value as PaymentStatusFilter)}><option value="PENDING">Pending</option><option value="VERIFIED">Verified</option><option value="REJECTED">Rejected</option><option value="NOT_REQUIRED">Not required</option><option value="ALL">All statuses</option></select>
      </div>
      {error ? <div className="payment-state"><AlertCircle size={21} /><h2>Payment records could not be loaded</h2><p>{error}</p><Button variant="secondary" onClick={() => void loadPayments()}>Try again</Button></div>
        : loading ? <PaymentSkeleton />
        : !records.length ? <div className="payment-state"><span className="payment-state-icon"><CreditCard size={20} /></span><h2>{params.status === "PENDING" && !params.search ? "No pending payments" : "No matching payments"}</h2><p>{params.status === "PENDING" && !params.search ? "New payment submissions will appear here for review." : "Try another status or search term."}</p></div>
        : <>
          <div className="payment-table-wrap"><table className="payment-table"><thead><tr><th>{type === "individual" ? "Participant" : "Team"}</th><th>Event</th><th>Method</th><th>Status</th><th>Proof</th><th>Submitted</th><th><span className="sr-only">Review</span></th></tr></thead><tbody>
            {records.map(record => <tr key={record.id}>
              <td><div className="payment-identity"><strong>{record.title}</strong><small>{record.subtitle}</small>{record.email && <small>{record.email}</small>}{record.mobile && <small>{record.mobile}</small>}{record.type === "team" && <small>{record.memberCount ?? "—"} members · {record.teamStatus === "CANCELLED" ? "Team cancelled" : "Shared payment"}</small>}</div></td>
              <td><strong className="payment-event-name">{record.event?.name || "Event unavailable"}</strong><small className="payment-event-meta">{record.event?.category || ""}{record.event?.startDate ? ` · ${formatDate(record.event.startDate)}` : ""}</small></td>
              <td><MethodBadge method={record.method} /></td><td><PaymentStatusBadge status={record.status} /></td>
              <td>{record.proofUrl && isSafeImageUrl(record.proofUrl) ? <ProofThumbnail url={record.proofUrl} onOpen={() => setProofPreview(record.proofUrl!)} /> : <span className="payment-proof-missing">{record.method === "UPI" ? "Not uploaded" : "—"}</span>}</td>
              <td>{formatDate(record.createdAt)}</td><td><Button variant="secondary" icon={<Eye size={14} />} onClick={() => setSelected(record)}>Review</Button></td>
            </tr>)}
          </tbody></table></div>
          <div className="payment-pagination"><span>{numberFormat.format(total)} records · Page {params.page} of {Math.max(1, totalPages)}</span><div><label>Rows <select aria-label="Rows per page" value={params.limit} onChange={event => setParams(current => ({ ...current, limit: Number(event.target.value), page: 1 }))}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label><Button variant="secondary" icon={<ChevronLeft size={14} />} onClick={() => setParams(current => ({ ...current, page: Math.max(1, current.page - 1) }))} disabled={params.page <= 1 || loading}>Previous</Button><Button variant="secondary" onClick={() => setParams(current => ({ ...current, page: current.page + 1 }))} disabled={params.page >= totalPages || loading}>Next <ChevronRight size={14} /></Button></div></div>
        </>}
    </Card>
    {selected && <PaymentDrawer record={selected} onClose={() => setSelected(null)} onPreview={setProofPreview} onDecision={setDecision} />}
    {decision && selected && <PaymentConfirmation decision={decision} type={selected.type} working={working} onCancel={() => setDecision(null)} onConfirm={() => void submitDecision()} />}
    {proofPreview && <ProofPreview url={proofPreview} onClose={() => setProofPreview(null)} />}
  </>;
}

function SummaryCard({ title, value, loading, error, icon, tone }: { title: string; value?: number; loading: boolean; error: string | null; icon: React.ReactNode; tone: "warning" | "success" }) {
  return <Card className="payment-summary-card"><span className={`payment-summary-icon tone-${tone}`}>{icon}</span><div><small>{title}</small>{loading ? <span className="payment-summary-skeleton" /> : error ? <strong className="summary-unavailable">Unavailable</strong> : <strong>{numberFormat.format(value ?? 0)}</strong>}</div></Card>;
}

function PaymentDrawer({ record, onClose, onPreview, onDecision }: { record: PaymentRecord; onClose: () => void; onPreview: (url: string) => void; onDecision: (decision: PaymentDecision) => void }) {
  const dialogRef = useAccessibleDialog(onClose);
  const proof = record.proofUrl && isSafeImageUrl(record.proofUrl) ? record.proofUrl : null;
  const actionable = record.status === "PENDING" && (record.type !== "team" || record.teamStatus === "REGISTERED");
  return <div className="payment-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><aside ref={dialogRef} className="payment-drawer" role="dialog" aria-modal="true" aria-labelledby="payment-review-title">
    <header><div><p>{record.type === "team" ? "SHARED TEAM PAYMENT" : "INDIVIDUAL PAYMENT"}</p><h2 id="payment-review-title">{record.title}</h2><small>{record.subtitle}</small></div><button className="payment-close" onClick={onClose} aria-label="Close payment details"><X size={18} /></button></header>
    <div className="payment-drawer-body">
      <section className="payment-review-section"><h3>Payment</h3><ReviewDetail label="Status"><PaymentStatusBadge status={record.status} /></ReviewDetail><ReviewDetail label="Method"><MethodBadge method={record.method} /></ReviewDetail><ReviewDetail label="Submitted" value={formatDate(record.createdAt)} />{record.type === "team" && <ReviewDetail label="Team members" value={String(record.memberCount ?? "—")} />}</section>
      {record.type === "individual" && <section className="payment-review-section"><h3>Participant</h3><ReviewDetail label="Email" value={record.email} /><ReviewDetail label="Mobile" value={record.mobile} /><ReviewDetail label="College" value={record.college} /><ReviewDetail label="Department" value={record.department} /></section>}
      {record.type === "team" && <section className="payment-review-section"><h3>Team leader</h3><ReviewDetail label="Name" value={record.title ? record.subtitle.split(" · ")[0] : undefined} /><ReviewDetail label="Email" value={record.email} /><ReviewDetail label="Team status" value={formatStatus(record.teamStatus || "UNKNOWN")} /></section>}
      <section className="payment-review-section"><h3>Event</h3><ReviewDetail label="Event" value={record.event?.name} /><ReviewDetail label="Category" value={record.event?.category} /><ReviewDetail label="Date" value={formatDate(record.event?.startDate)} /></section>
      <section className="payment-review-section"><h3>Payment proof</h3>{proof ? <button className="payment-proof-large" onClick={() => onPreview(proof)}><img src={proof} alt="Payment proof" onError={event => { event.currentTarget.hidden = true; }} /><span>Open full image</span></button> : <p className="payment-no-proof"><FileBadge size={17} />No payment proof is available for this record.</p>}</section>
      {actionable && <div className="payment-review-actions"><Button variant="secondary" className="payment-reject-button" onClick={() => onDecision("REJECTED")}>Reject payment</Button><Button variant="primary" className="payment-verify-button" onClick={() => onDecision("VERIFIED")}>Verify payment</Button></div>}
      {!actionable && <p className="payment-readonly-note">This payment is not pending and cannot be changed.</p>}
    </div>
  </aside></div>;
}

function ReviewDetail({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) { return <div className="payment-review-detail"><span>{label}</span><strong>{children || value || "—"}</strong></div>; }

function PaymentConfirmation({ decision, type, working, onCancel, onConfirm }: { decision: PaymentDecision; type: PaymentType; working: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useAccessibleDialog(onCancel, working);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !working) onCancel(); }}><section ref={dialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="payment-confirm-title" aria-describedby="payment-confirm-description"><div className="confirm-icon"><AlertCircle size={19} /></div><h2 id="payment-confirm-title">{decision === "VERIFIED" ? "Verify this payment?" : "Reject this payment?"}</h2><p id="payment-confirm-description">{decision === "VERIFIED" ? `This ${type === "team" ? "shared team payment" : "individual payment"} will be marked verified.` : `This ${type === "team" ? "shared team payment" : "individual payment"} will be marked rejected.`}</p><div className="dialog-actions"><Button variant="secondary" onClick={onCancel} disabled={working}>Go back</Button><Button variant="primary" className={decision === "VERIFIED" ? "payment-verify-button" : "button-danger"} onClick={onConfirm} disabled={working}>{working ? "Saving…" : decision === "VERIFIED" ? "Verify payment" : "Reject payment"}</Button></div></section></div>;
}

function ProofThumbnail({ url, onOpen }: { url: string; onOpen: () => void }) { const [failed, setFailed] = useState(false); if (failed) return <span className="payment-proof-missing">Unavailable</span>; return <button className="payment-proof-thumb" onClick={onOpen} aria-label="Open payment proof"><img src={url} alt="Payment proof thumbnail" loading="lazy" onError={() => setFailed(true)} /></button>; }

function ProofPreview({ url, onClose }: { url: string; onClose: () => void }) { const dialogRef = useAccessibleDialog(onClose); return <div className="proof-preview-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className="proof-preview-dialog" role="dialog" aria-modal="true" aria-label="Payment proof preview"><button className="payment-close" onClick={onClose} aria-label="Close image preview"><X size={19} /></button><img src={url} alt="Full payment proof" onError={event => { event.currentTarget.alt = "Payment proof image could not be loaded"; }} /></section></div>; }

function mapIndividualPayment(record: IndividualPaymentRecord): PaymentRecord { return { id: record._id, type: "individual", title: record.participantDetails?.fullName || record.user?.name || "Name unavailable", subtitle: record.participantDetails?.collegeName || "College unavailable", email: record.user?.email, mobile: record.participantDetails?.mobileNumber, college: record.participantDetails?.collegeName, department: record.participantDetails?.department, event: record.event, method: record.payment?.method || "UNKNOWN", status: record.payment?.status || "UNKNOWN", proofUrl: record.payment?.proofUrl, createdAt: record.createdAt }; }
function mapTeamPayment(record: TeamPaymentRecord): PaymentRecord { return { id: record._id, type: "team", title: record.teamName || "Team unavailable", subtitle: `${record.leader?.name || "Leader unavailable"}${record.leader?.email ? ` · ${record.leader.email}` : ""}`, email: record.leader?.email, memberCount: record.memberCount, event: record.event, method: record.payment?.method || "UNKNOWN", status: record.payment?.status || "UNKNOWN", proofUrl: record.payment?.proofUrl, createdAt: record.createdAt, teamStatus: record.status }; }
function PaymentStatusBadge({ status }: { status: string }) { return <span className={`payment-status-badge payment-${status.toLowerCase().replace(/_/g, "-")}`}>{formatStatus(status)}</span>; }
function MethodBadge({ method }: { method: string }) { return <span className="payment-method-badge">{formatStatus(method)}</span>; }
function PaymentSkeleton() { return <div className="payment-skeleton" aria-label="Loading payments">{[0, 1, 2, 3, 4].map(row => <span key={row} />)}</div>; }
function isSafeImageUrl(value: string) { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; } }
function formatStatus(value: string) { return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase()); }
function formatDate(value?: string | null) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", ...(value.includes("T") ? { timeStyle: "short" as const } : {}) }).format(date); }
