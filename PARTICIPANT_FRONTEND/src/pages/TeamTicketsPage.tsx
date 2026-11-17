import { useEffect, useState } from "react";
import axios from "axios";
import { Link, useParams } from "react-router-dom";
import { getLeaderTeamTickets, type TeamTicketsResponse } from "../api/teamService";
import TicketCard from "../components/tickets/TicketCard";
import type { DigitalTicket } from "../api/registrationService";

export default function TeamTicketsPage() {
  const { teamId } = useParams();
  const [result, setResult] = useState<TeamTicketsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setResult(null);
    setError(null);
    if (!teamId) { setError("This team ticket link is invalid."); setLoading(false); return () => controller.abort(); }
    getLeaderTeamTickets(teamId, controller.signal)
      .then(setResult)
      .catch((requestError: unknown) => { if (!axios.isCancel(requestError)) setError(ticketError(requestError)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [teamId]);

  if (loading) return <section className="ticket-state"><span className="participant-loading-bar" /><p>Verifying team tickets…</p></section>;
  if (error || !result) return <section className="ticket-state"><span className="discover-state-mark">!</span><p className="participant-eyebrow">TEAM TICKETS</p><h1>Tickets unavailable</h1><p>{error || "Valid QR tickets are not available."}</p><div><Link className="registration-secondary-button" to={`/teams/${teamId || ""}`}>Team details</Link><Link className="participant-button" to="/my-registrations">My Registrations</Link></div></section>;

  return <div className="team-tickets-page">
    <div className="ticket-page-actions"><Link to={`/teams/${teamId}`} className="event-detail-back">← Team details</Link><button className="participant-button" type="button" onClick={() => window.print()}>Print / Save as PDF</button></div>
    <header className="team-tickets-heading"><p className="participant-eyebrow">TEAM ADMISSION</p><h1>{result.team.name}</h1><p>{result.team.event.name} · {result.tickets.length} ticket{result.tickets.length === 1 ? "" : "s"}</p></header>
    {result.unavailableCount > 0 && <p className="ticket-partial-note" role="status">{result.unavailableCount} registered member record{result.unavailableCount === 1 ? " has" : "s have"} no valid QR token. Contact the event administrator.</p>}
    <div className="team-ticket-list">{result.tickets.map((ticket) => {
      const fullTicket: DigitalTicket = {
        registrationId: ticket.registrationId,
        registrationType: "TEAM",
        attendeeName: ticket.attendeeName,
        teamName: result.team.name,
        isTeamLeader: ticket.isTeamLeader,
        qrToken: ticket.qrToken,
        registrationStatus: ticket.registrationStatus,
        paymentStatus: result.team.paymentStatus,
        ticketStatus: result.team.ticketStatus,
        event: result.team.event,
      };
      return <TicketCard key={ticket.registrationId} ticket={fullTicket} />;
    })}</div>
  </div>;
}

function ticketError(error: unknown) {
  if (!axios.isAxiosError(error)) return "Team tickets could not be loaded. Please try again.";
  const status = error.response?.status;
  const code = error.response?.data?.code;
  if (status === 401) return "Your participant session has expired. Sign in again to view team tickets.";
  if (status === 403 && code === "TEAM_LEADER_REQUIRED") return "These team tickets are available to the team leader only.";
  if (status === 403) return "This account is not authorized to access participant team tickets.";
  if (status === 404 && code === "TEAM_NOT_FOUND") return "This team could not be found.";
  if (status === 404 && code === "TEAM_EVENT_NOT_FOUND") return "The event associated with this team could not be found.";
  if (status === 404) return "The team ticket endpoint is unavailable on the running backend. Restart or update the backend, then try again.";
  if (status === 400 && code === "INVALID_TEAM") return "This team link is invalid.";
  if (code === "TEAM_CANCELLED") return "This team registration is cancelled and has no valid tickets.";
  if (code === "EVENT_CANCELLED") return "This event was cancelled. Its tickets are not valid.";
  if (code === "PAYMENT_NOT_ELIGIBLE") return "Team tickets are available only when the shared payment is verified or no payment is required.";
  if (code === "QR_UNAVAILABLE") return "No valid QR tickets are available for this team.";
  return "Team tickets could not be loaded. Please try again.";
}
