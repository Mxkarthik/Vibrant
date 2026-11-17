import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getParticipantDashboard, type ParticipantDashboard } from "../api/participantService";

export default function ParticipantDashboardPage() {
  const { user, refreshUser } = useAuth();
  const [dashboard, setDashboard] = useState<ParticipantDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async (manual = false) => {
    setLoading(true);
    setRefreshing(manual);
    setError(null);
    try {
      setDashboard(await getParticipantDashboard());
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        await refreshUser();
      } else {
        setError(axios.isAxiosError(requestError) ? requestError.response?.data?.message || "Dashboard information could not be loaded." : "Dashboard information could not be loaded.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [refreshUser]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  const initials = user?.name?.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "V";

  return <div className="participant-dashboard">
    <div className="participant-page-heading">
      <div><p className="participant-eyebrow">VIBRANT2K26 · PARTICIPANT SPACE</p><h1>Your dashboard</h1><p className="participant-page-description">A personal view of your registrations and upcoming moments.</p></div>
      <button className="participant-refresh-button" type="button" onClick={() => void loadDashboard(true)} disabled={loading}>{refreshing ? "Refreshing…" : "Refresh"}<span aria-hidden="true">↻</span></button>
    </div>

    <section className="participant-welcome" aria-labelledby="participant-welcome-title">
      <div className="participant-welcome-copy"><p className="participant-eyebrow">WELCOME BACK</p><h2 id="participant-welcome-title">{user?.name ? `Hello, ${user.name}.` : "Hello."}</h2><p>Your VIBRANT journey continues here. Find your registrations and get ready for what’s next.</p><span className="participant-email">{user?.email}</span></div>
      {user?.profilePicture ? <img className="participant-welcome-avatar" src={user.profilePicture} alt={`${user.name} profile`} referrerPolicy="no-referrer" /> : <span className="participant-welcome-avatar participant-welcome-initials" aria-label={`${user?.name || "Participant"} profile`}>{initials}</span>}
      <span className="participant-welcome-edition" aria-hidden="true">V2K26</span>
    </section>

    <section className="participant-stats-grid" aria-label="Registration statistics">
      <StatCard label="Total registrations" value={dashboard?.stats.totalRegistrations} icon="▤" tone="blue" loading={loading} />
      <StatCard label="Upcoming events" value={dashboard?.stats.upcomingEvents} icon="◷" tone="navy" loading={loading} />
      <StatCard label="Pending payments" value={dashboard?.stats.pendingPayments} icon="₹" tone="amber" loading={loading} />
      <StatCard label="Completed events" value={dashboard?.stats.completedEvents} icon="✓" tone="green" loading={loading} />
    </section>

    {error && <div className="participant-dashboard-error" role="alert"><p>{error}</p><button type="button" onClick={() => void loadDashboard()}>Try again</button></div>}

    <section className="participant-dashboard-section" aria-labelledby="upcoming-heading">
      <div className="participant-section-heading"><div><p className="participant-eyebrow">ON YOUR CALENDAR</p><h2 id="upcoming-heading">Upcoming registered events</h2></div><Link to="/events">Explore events <span aria-hidden="true">↗</span></Link></div>
      {loading ? <div className="participant-event-skeletons" aria-label="Loading upcoming events"><span /><span /></div> : error ? null : dashboard?.upcomingEvents.length ? <div className="participant-event-list">
        {dashboard.upcomingEvents.map((event) => <article className="participant-event-row" key={event.registrationId}>
          {event.poster ? <img className="participant-event-poster" src={event.poster} alt="" loading="lazy" /> : <div className="participant-event-poster participant-event-poster-empty" aria-hidden="true">V</div>}
          <div className="participant-event-main"><span className="participant-category">{event.category}</span><h3>{event.name}</h3><p>{formatDate(event.startDate)}{event.endDate !== event.startDate ? ` – ${formatDate(event.endDate)}` : ""} · {event.venue}</p>{event.teamName && <Link className="participant-team-label" to={event.teamId ? `/teams/${event.teamId}` : "/registrations"}>{event.teamName} · View team</Link>}</div>
          <div className="participant-event-meta"><StatusBadge value={event.registrationStatus} /><span>Payment · <StatusBadge value={event.paymentStatus} compact /></span><Link to={`/events/${event.eventId}`}>View details <span aria-hidden="true">↗</span></Link></div>
        </article>)}
      </div> : <div className="participant-empty-state"><span className="participant-empty-mark">✳</span><h3>No upcoming registrations yet</h3><p>When you register for an event, it will appear here.</p><Link className="participant-button" to="/events">Explore Events</Link></div>}
    </section>

    <section className="participant-dashboard-section participant-recent-section" aria-labelledby="recent-heading">
      <div className="participant-section-heading"><div><p className="participant-eyebrow">YOUR ACTIVITY</p><h2 id="recent-heading">Recent registrations</h2></div><Link to="/my-registrations">All registrations <span aria-hidden="true">↗</span></Link></div>
      {loading ? <div className="participant-recent-skeleton" aria-label="Loading recent registrations"><span /><span /><span /></div> : error ? null : dashboard?.recentRegistrations.length ? <div className="participant-activity-list">
        {dashboard.recentRegistrations.map((registration) => <article className="participant-activity-row" key={registration.id}>
          <div className="participant-activity-mark" aria-hidden="true">{registration.registrationType === "TEAM" ? "T" : "I"}</div>
          <div className="participant-activity-copy"><h3>{registration.eventName || "Event details unavailable"}</h3><p>{formatDate(registration.registeredAt, true)} · {registration.registrationType === "TEAM" ? `Team${registration.teamName ? ` · ${registration.teamName}` : ""}` : "Individual"}{registration.teamId && <> · <Link to={`/teams/${registration.teamId}`}>View team</Link></>}</p></div>
          <div className="participant-activity-status"><StatusBadge value={registration.registrationStatus} /><StatusBadge value={registration.paymentStatus} />{registration.certificateIssued && <Link to="/my-certificates">View certificate</Link>}</div>
        </article>)}
      </div> : !error && <div className="participant-empty-inline"><p>Your recent registrations will appear here.</p><Link to="/events">Explore events <span aria-hidden="true">↗</span></Link></div>}
    </section>

    <section className="participant-quick-actions" aria-label="Quick actions">
      <div><p className="participant-eyebrow">KEEP EXPLORING</p><h2>Your next moment is out there.</h2></div>
      <div className="participant-quick-links"><Link to="/events">Explore Events <span>↗</span></Link><Link to="/my-registrations">My Registrations <span>↗</span></Link><Link to="/my-attendance">My Attendance <span>↗</span></Link><Link to="/profile">My Profile <span>↗</span></Link></div>
    </section>
  </div>;
}

function StatCard({ label, value, icon, tone, loading }: { label: string; value?: number; icon: string; tone: string; loading: boolean }) {
  return <article className="participant-stat-card"><span className={`participant-stat-icon tone-${tone}`} aria-hidden="true">{icon}</span><p>{label}</p>{loading ? <span className="participant-stat-skeleton" /> : value === undefined ? <strong aria-label="Unavailable">—</strong> : <strong>{formatNumber(value)}</strong>}</article>;
}

function StatusBadge({ value, compact = false }: { value: string; compact?: boolean }) {
  const label = value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  const tone = value === "REGISTERED" || value === "VERIFIED" ? "success" : value === "PENDING" ? "warning" : value === "CANCELLED" || value === "REJECTED" ? "danger" : "neutral";
  return <span className={`participant-status-badge badge-${tone}${compact ? " is-compact" : ""}`}>{label}</span>;
}

function formatDate(value: string, withYear = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) }).format(date);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}
