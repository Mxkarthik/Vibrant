import { QRCodeSVG } from "qrcode.react";
import type { DigitalTicket } from "../../api/registrationService";

export default function TicketCard({ ticket }: { ticket: DigitalTicket }) {
  const isCombo = ticket.access?.type === "MULTI_EVENT";
  const eligibleIds = ticket.access?.eligibleEventIds || [];
  const eligibleCount = eligibleIds.length;
  const entitledEvents = ticket.entitledEvents || [];

  return <article className="digital-ticket-card">
    <header className="digital-ticket-brand">
      <span>VIBRANT<span>2K26</span></span>
      <div className="digital-ticket-brand-right">
        {isCombo && <span className="digital-ticket-combo-badge">MULTI-EVENT COMBO PASS</span>}
        <small>DIGITAL ADMISSION TICKET</small>
      </div>
    </header>
    <div className="digital-ticket-event">
      <p className="participant-eyebrow">{ticket.event.category || "VIBRANT2K26"}</p>
      <h2>{ticket.event.name}</h2>
      <p>{formatDateRange(ticket.event.startDate, ticket.event.endDate)}</p>
      <p>{ticket.event.venue}</p>
    </div>
    <div className="digital-ticket-content">
      <div className="digital-ticket-person">
        <span>{ticket.registrationType === "TEAM" ? "TICKET HOLDER" : "PARTICIPANT"}</span>
        <strong>{ticket.attendeeName}</strong>
        {ticket.teamName && <small>{ticket.teamName} · Team registration{ticket.isTeamLeader ? " (Leader)" : ""}</small>}
      </div>
      <div className="digital-ticket-qr">
        <QRCodeSVG value={ticket.qrToken} size={224} level="H" includeMargin bgColor="#FFFFFF" fgColor="#000000" title="Secure admission QR code" />
        <p>{isCombo ? "Present this code at any included event check-in" : "Present this code at event check-in"}</p>
      </div>
    </div>

    {isCombo && (
      <section className="digital-ticket-entitlements" aria-label="Events included in combo pass">
        <div className="digital-ticket-entitlements-header">
          <h3>Events Included in This Pass</h3>
          <span>{eligibleCount} {eligibleCount === 1 ? "Event" : "Events"} Covered</span>
        </div>
        {entitledEvents.length > 0 ? (
          <ul className="digital-ticket-entitlements-list">
            {entitledEvents.map((child, index) => (
              <li key={child._id || `event-${index}`}>
                <div className="digital-ticket-entitled-main">
                  <strong>{child.name || `Included Event (${(child._id || "").slice(-6)})`}</strong>
                  {child.venue && <span>· {child.venue}</span>}
                </div>
                {child.startDate && (
                  <small>
                    {child.endDate ? formatDateRange(child.startDate, child.endDate) : formatDate(child.startDate)}
                  </small>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="digital-ticket-entitlements-fallback">
            Covers {eligibleCount} included events. Details are accessible on your event registration record.
          </p>
        )}
        <p className="digital-ticket-scan-instruction">
          Present this same QR code at each event included in your pass. Admission is subject to registration, payment and event eligibility.
        </p>
      </section>
    )}

    <footer className="digital-ticket-footer">
      <div><span>REGISTRATION REFERENCE</span><strong>{ticket.registrationId}</strong></div>
      <div><span>REGISTRATION TYPE</span><strong>{isCombo ? (ticket.registrationType === "TEAM" ? "Team member combo pass" : "Individual combo pass") : (ticket.registrationType === "TEAM" ? "Team member ticket" : "Individual")}</strong></div>
      <div className="digital-ticket-state"><span>TICKET STATUS</span><strong className={ticket.ticketStatus === "HISTORICAL" ? "is-historical" : "is-valid"}>{ticket.ticketStatus === "HISTORICAL" ? "Historical ticket" : "Valid ticket"}</strong></div>
    </footer>
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

export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
