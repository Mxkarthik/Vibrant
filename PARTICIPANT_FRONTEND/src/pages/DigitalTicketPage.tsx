import { useEffect, useState } from "react";
import axios from "axios";
import { Link, useParams } from "react-router-dom";
import { getIndividualTicket, type DigitalTicket } from "../api/registrationService";
import TicketCard from "../components/tickets/TicketCard";

export default function DigitalTicketPage() {
  const { registrationId } = useParams();
  const [ticket, setTicket] = useState<DigitalTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setTicket(null);
    setError(null);
    if (!registrationId) { setError("This ticket link is invalid."); setLoading(false); return () => controller.abort(); }
    getIndividualTicket(registrationId, controller.signal)
      .then(setTicket)
      .catch((requestError: unknown) => { if (!axios.isCancel(requestError)) setError(ticketError(requestError)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [registrationId]);

  if (loading) return <section className="ticket-state"><span className="participant-loading-bar" /><p>Verifying your ticket…</p></section>;
  if (error || !ticket) return <section className="ticket-state"><span className="discover-state-mark">!</span><p className="participant-eyebrow">DIGITAL TICKET</p><h1>Ticket unavailable</h1><p>{error || "A valid QR ticket is not available."}</p><div><Link className="registration-secondary-button" to={`/registrations/${registrationId || ""}`}>Registration details</Link><Link className="participant-button" to="/my-registrations">My Registrations</Link></div></section>;

  return <div className="ticket-page-wrap">
    <div className="ticket-page-actions"><Link to={`/registrations/${ticket.registrationId}`} className="event-detail-back">← Registration details</Link><button className="participant-button" type="button" onClick={() => window.print()}>Print / Save as PDF</button></div>
    <TicketCard ticket={ticket} />
  </div>;
}

function ticketError(error: unknown) {
  if (!axios.isAxiosError(error)) return "Ticket details could not be loaded. Please try again.";
  const status = error.response?.status;
  const code = error.response?.data?.code;
  if (status === 401) return "Your participant session has expired. Sign in again to view your ticket.";
  if (status === 403 || status === 404) return "This ticket is not available to your account.";
  if (code === "REGISTRATION_CANCELLED") return "This registration is cancelled and has no valid ticket.";
  if (code === "EVENT_CANCELLED") return "This event was cancelled. Its ticket is not valid.";
  if (code === "PAYMENT_NOT_ELIGIBLE") return "A ticket will be available after payment is verified.";
  if (code === "QR_UNAVAILABLE") return "A valid ticket QR is not available for this registration.";
  return "Ticket details could not be loaded. Please try again.";
}
