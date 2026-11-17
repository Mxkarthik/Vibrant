import { QRCodeSVG } from "qrcode.react";
import type { DigitalTicket } from "../../api/registrationService";

export default function TicketCard({ ticket }: { ticket: DigitalTicket }) {
  return <article className="digital-ticket-card">
    <header className="digital-ticket-brand"><span>VIBRANT<span>2K26</span></span><small>DIGITAL ADMISSION TICKET</small></header>
    <div className="digital-ticket-event"><p className="participant-eyebrow">{ticket.event.category || "VIBRANT2K26"}</p><h2>{ticket.event.name}</h2><p>{formatDateRange(ticket.event.startDate, ticket.event.endDate)}</p><p>{ticket.event.venue}</p></div>
    <div className="digital-ticket-content">
      <div className="digital-ticket-person"><span>{ticket.registrationType === "TEAM" ? "TICKET HOLDER" : "PARTICIPANT"}</span><strong>{ticket.attendeeName}</strong>{ticket.teamName && <small>{ticket.teamName} · Team registration</small>}</div>
      <div className="digital-ticket-qr"><QRCodeSVG value={ticket.qrToken} size={224} level="H" includeMargin bgColor="#FFFFFF" fgColor="#000000" title="Secure admission QR code" /><p>Present this code at event check-in</p></div>
    </div>
    <footer className="digital-ticket-footer"><div><span>REGISTRATION REFERENCE</span><strong>{ticket.registrationId}</strong></div><div><span>REGISTRATION TYPE</span><strong>{ticket.registrationType === "TEAM" ? "Team member ticket" : "Individual"}</strong></div><div className="digital-ticket-state"><span>TICKET STATUS</span><strong className={ticket.ticketStatus === "HISTORICAL" ? "is-historical" : "is-valid"}>{ticket.ticketStatus === "HISTORICAL" ? "Historical ticket" : "Valid ticket"}</strong></div></footer>
    {ticket.ticketStatus === "HISTORICAL" && <p className="digital-ticket-historical-note">This event has ended. This ticket is retained for your records and is not for admission.</p>}
  </article>;
}

export function formatDateRange(start: string, end: string) {
  const format = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  };
  return start === end ? format(start) : `${format(start)} – ${format(end)}`;
}
