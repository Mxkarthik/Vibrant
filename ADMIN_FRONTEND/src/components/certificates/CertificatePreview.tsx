import { X } from "lucide-react";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";

interface CertificatePreviewProps {
  participantName: string;
  eventName: string;
  eventStartDate?: string;
  certificateId?: string | null;
  issuedAt?: string | null;
  onClose: () => void;
}

export default function CertificatePreview({ participantName, eventName, eventStartDate, certificateId, issuedAt, onClose }: CertificatePreviewProps) {
  const dialogRef = useAccessibleDialog(onClose);

  return <div className="certificate-preview-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="certificate-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="certificate-preview-title">
      <header><div><p>CERTIFICATE PREVIEW</p><h2 id="certificate-preview-title">{participantName}</h2></div><button onClick={onClose} aria-label="Close certificate preview"><X size={18} /></button></header>
      <article className="certificate-paper">
        <div className="certificate-paper-inner">
          <p className="certificate-institution">DADI INSTITUTE OF ENGINEERING AND TECHNOLOGY</p>
          <h1>CERTIFICATE</h1><h2>OF PARTICIPATION</h2>
          <p className="certificate-intro">This certificate is proudly presented to</p>
          <p className="certificate-participant" title={participantName}>{participantName}</p>
          <p className="certificate-for">For successfully participating in</p>
          <p className="certificate-event" title={eventName}>{eventName}</p>
          <p className="certificate-date">Event Date: {formatDate(eventStartDate)}</p>
          <footer><div><span>Certificate ID: {certificateId || "Assigned upon issuance"}</span><span>Issued: {issuedAt ? formatDate(issuedAt) : "Upon issuance"}</span></div><strong>Authorized Signature</strong></footer>
        </div>
      </article>
    </section>
  </div>;
}

function formatDate(value?: string) { if (!value) return "Date unavailable"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(date); }
