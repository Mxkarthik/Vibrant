import { useEffect, useState } from "react";
import axios from "axios";
import { Link, useParams } from "react-router-dom";
import { getRegistrationRecord, uploadIndividualPaymentProof, type RegistrationRecordView } from "../api/registrationService";
import PaymentProofPanel from "../components/payment/PaymentProofPanel";

export default function RegistrationReceiptPage() {
  const { registrationId } = useParams();
  const [record, setRecord] = useState<RegistrationRecordView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setRecord(null);
    setError(null);
    setLoading(true);
    if (!registrationId) {
      setError("This registration link is invalid.");
      setLoading(false);
      return () => controller.abort();
    }
    getRegistrationRecord(registrationId, controller.signal)
      .then(setRecord)
      .catch((requestError: unknown) => {
        if (axios.isCancel(requestError)) return;
        const status = axios.isAxiosError(requestError) ? requestError.response?.status : undefined;
        setError(status === 400 ? "This registration link is invalid." : status === 403 ? "This registration belongs to a different account." : status === 404 ? "This registration could not be found." : status === 401 ? "Your session has expired. Sign in again to view this registration." : "Registration details could not be loaded. Please try again.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [registrationId]);

  if (loading) return <main className="registration-loading"><Link to="/my-registrations" className="event-detail-back">← My Registrations</Link><div className="event-detail-skeleton"><span /><div><i /><i /><i /></div></div><p>Loading your registration…</p></main>;
  if (error || !record) return <section className="registration-availability-error"><span className="discover-state-mark">!</span><p className="participant-eyebrow">REGISTRATION</p><h1>Registration unavailable</h1><p>{error || "Registration details could not be loaded."}</p><div><Link className="participant-button" to="/my-registrations">My Registrations</Link>{error?.includes("Sign in") && <Link to="/login" className="event-detail-secondary-action">Sign in again</Link>}</div></section>;

  return <section className="registration-receipt-view">
    <div className="event-detail-breadcrumb"><Link to="/my-registrations">← My Registrations</Link><span aria-hidden="true">/</span><span>Registration details</span></div>
    <header className="registration-receipt-heading"><span className="registration-success-mark" aria-hidden="true">✓</span><div><p className="participant-eyebrow">VIBRANT2K26 · REGISTRATION RECEIPT</p><h1>Registration details</h1><p>This view is private to the account that created this registration.</p></div></header>
    <div className="registration-receipt-card">
      <div className="registration-review-event"><span>Event</span><strong>{record.event?.name || "Event details unavailable"}</strong></div>
      <div className="registration-review-grid">
        <ReceiptItem label="Registration reference" value={record.id} />
        <ReceiptItem label="Registration type" value="Individual" />
        <ReceiptItem label="Registration status" value={formatStatus(record.status)} />
        <ReceiptItem label="Submitted" value={formatDate(record.createdAt)} />
        <ReceiptItem label="Participant" value={record.participantDetails.fullName} />
        <ReceiptItem label="Mobile number" value={record.participantDetails.mobileNumber} />
        <ReceiptItem label="College" value={record.participantDetails.collegeName} />
        <ReceiptItem label="Department" value={record.participantDetails.department} />
        <ReceiptItem label="Year / section" value={`${record.participantDetails.yearOfStudy} · ${record.participantDetails.section}`} />
        <ReceiptItem label="Roll number" value={record.participantDetails.rollNumber} />
        <ReceiptItem label="Payment status" value={formatStatus(record.paymentStatus)} />
        {record.paymentMethod !== "NONE" && <ReceiptItem label="Payment method" value={record.paymentMethod} />}
        {record.event?.venue && <ReceiptItem label="Venue" value={record.event.venue} />}
        {record.event?.startDate && <ReceiptItem label="Event date" value={formatDateRange(record.event.startDate, record.event.endDate)} />}
      </div>
      <PaymentProofPanel title="Individual payment" amount={record.amount} method={record.paymentMethod} status={record.paymentStatus} proofUrl={record.paymentProofUrl} eventQrUrl={record.event?.paymentQrUrl} cashReceiverName={record.cashReceiverName} onUpload={(file, progress) => uploadIndividualPaymentProof(record.id, file, progress)} onUploaded={(proofUrl) => { setRecord((current) => current ? { ...current, paymentProofUrl: proofUrl } : current); void getRegistrationRecord(record.id).then(setRecord).catch(() => undefined); }} />
      <div className="registration-form-actions"><Link to={`/events/${record.event?.id || ""}`} className="registration-secondary-button">Back to Event</Link><Link to="/my-registrations" className="registration-secondary-button">My Registrations</Link>{record.status === "REGISTERED" && record.event?.status !== "CANCELLED" && ["VERIFIED", "NOT_REQUIRED"].includes(record.paymentStatus) && <Link to={`/registrations/${record.id}/ticket`} className="participant-button">Digital Ticket <span aria-hidden="true">↗</span></Link>}</div>
    </div>
  </section>;
}

function ReceiptItem({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value || "—"}</strong></div>; }
function formatStatus(value: string) { return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date); }
function formatDateRange(start: string, end: string) { return `${formatDate(start)} – ${formatDate(end)}`; }
