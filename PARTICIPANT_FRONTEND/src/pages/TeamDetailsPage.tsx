import { useEffect, useState } from "react";
import axios from "axios";
import { Link, useParams } from "react-router-dom";
import { getLeaderTeam, uploadTeamPaymentProof, type LeaderTeamDetails } from "../api/teamService";
import PaymentProofPanel from "../components/payment/PaymentProofPanel";

export default function TeamDetailsPage() {
  const { teamId } = useParams();
  const [team, setTeam] = useState<LeaderTeamDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    if (!teamId) {
      setError("This team link is invalid.");
      setLoading(false);
      return () => controller.abort();
    }
    getLeaderTeam(teamId, controller.signal)
      .then(setTeam)
      .catch((requestError: unknown) => {
        if (axios.isCancel(requestError)) return;
        const status = axios.isAxiosError(requestError) ? requestError.response?.status : undefined;
        setError(status === 401 ? "Your participant session has expired. Sign in again to view this team." : status === 403 || status === 404 ? "This team is unavailable to your account." : "Team details could not be loaded. Please try again.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [teamId]);

  if (loading) return <main className="team-details-page"><Link to="/dashboard" className="event-detail-back">← Dashboard</Link><div className="event-detail-skeleton"><span /><div><i /><i /><i /></div></div><p>Loading team details…</p></main>;
  if (error || !team) return <section className="registration-availability-error"><span className="discover-state-mark">!</span><p className="participant-eyebrow">TEAM DETAILS</p><h1>Team unavailable</h1><p>{error || "Team details could not be loaded."}</p><div><Link className="participant-button" to="/dashboard">Back to dashboard</Link><Link className="event-detail-secondary-action" to="/events">Explore events</Link></div></section>;

  return <div className="team-details-page">
    <Link to={team.event ? `/events/${team.event.id}` : "/dashboard"} className="event-detail-back">← {team.event ? "Back to Event" : "Dashboard"}</Link>
    <header className="individual-registration-heading"><p className="participant-eyebrow">VIBRANT2K26 · TEAM REGISTRATION</p><h1>{team.teamName}</h1><p>{team.event?.name || "Event details unavailable"} · Team leader view</p></header>
    {team.event?.poster && <img className="team-details-poster" src={team.event.poster} alt={`${team.event.name} poster`} />}
    <section className="registration-review-card team-details-card">
      <p className="participant-eyebrow">TEAM SUMMARY</p>
      <div className="registration-review-grid">
        <ReviewItem label="Event" value={team.event?.name || "Unavailable"} />
        <ReviewItem label="Team registration reference" value={team.id} />
        <ReviewItem label="Team size" value={`${team.memberCount} members`} />
        <ReviewItem label="Team status" value={formatStatus(team.status)} />
        <ReviewItem label="Shared payment method" value={team.paymentMethod} />
        <ReviewItem label="Shared payment status" value={formatStatus(team.paymentStatus)} />
        {team.event?.startDate && <ReviewItem label="Event date" value={formatDate(team.event.startDate, team.event.endDate)} />}
        {team.event?.venue && <ReviewItem label="Venue" value={team.event.venue} />}
      </div>
      <PaymentProofPanel title="Shared team payment" amount={team.amount} method={team.paymentMethod} status={team.paymentStatus} proofUrl={team.paymentProofUrl} eventQrUrl={team.event?.paymentQrUrl} cashReceiverName={team.cashReceiverName} onUpload={(file, progress) => uploadTeamPaymentProof(team.id, file, progress)} onUploaded={(proofUrl) => { setTeam((current) => current ? { ...current, paymentProofUrl: proofUrl } : current); void getLeaderTeam(team.id).then(setTeam).catch(() => undefined); }} />
    </section>
    <section className="registration-review-card team-details-card">
      <div className="registration-form-section-title"><div><p className="participant-eyebrow">REGISTERED MEMBERS</p><h2>Team roster</h2></div><span className="registration-required-note">{team.members.length} members</span></div>
      {team.members.length ? <div className="team-details-roster">{team.members.map((member, index) => <article key={member.registrationId}>
        <span className="team-review-index">{member.isTeamLeader ? "L" : index + 1}</span>
        <div className="team-details-member-copy"><strong>{member.participantDetails.fullName}{member.isTeamLeader && <em>Leader</em>}</strong><p>{member.participantDetails.collegeName} · {member.participantDetails.department} · {member.participantDetails.yearOfStudy}</p><small>{member.participantDetails.rollNumber} · {member.participantDetails.mobileNumber}</small></div>
        <span className="participant-status-badge badge-success">{formatStatus(member.status)}</span>
      </article>)}</div> : <p className="participant-empty-inline">No team member records are available.</p>}
      <div className="registration-form-actions"><Link className="registration-secondary-button" to="/dashboard">Dashboard</Link>{team.event && <Link className="registration-secondary-button" to={`/events/${team.event.id}`}>View Event</Link>}{team.status === "REGISTERED" && team.event?.status !== "CANCELLED" && ["VERIFIED", "NOT_REQUIRED"].includes(team.paymentStatus) && <Link className="participant-button" to={`/teams/${team.id}/tickets`}>Team tickets <span aria-hidden="true">↗</span></Link>}</div>
    </section>
    <p className="team-details-note">Team membership is fixed at registration. Contact the event administrator if a correction is needed.</p>
  </div>;
}

function ReviewItem({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value || "—"}</strong></div>; }
function formatStatus(value: string) { return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(start: string, end: string) {
  const format = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(date); };
  return start === end ? format(start) : `${format(start)} – ${format(end)}`;
}
