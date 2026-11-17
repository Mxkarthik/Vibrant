import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { getMyRegistrations, type MyRegistration } from "../api/registrationService";

type Filter = "ALL" | "UPCOMING" | "COMPLETED" | "CANCELLED";
type Sort = "EVENT_DATE" | "NEWEST" | "OLDEST";

export default function MyRegistrationsPage() {
  const [registrations, setRegistrations] = useState<MyRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("NEWEST");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getMyRegistrations(controller.signal)
      .then(setRegistrations)
      .catch((requestError: unknown) => {
        if (axios.isCancel(requestError)) return;
        const status = axios.isAxiosError(requestError) ? requestError.response?.status : undefined;
        setError(status === 401 ? "Your session has expired. Sign in again to view your registrations." : status === 403 ? "This account cannot access participant registrations." : "Your registrations could not be loaded. Check your connection and try again.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const now = Date.now();
    const filtered = registrations.filter((registration) => {
      const eventStatus = registration.event?.status;
      const cancelled = registration.status === "CANCELLED" || eventStatus === "CANCELLED";
      const completed = eventStatus === "COMPLETED";
      const upcoming = Boolean(registration.event && !cancelled && !completed && new Date(registration.event.endDate).getTime() >= now);
      if (filter === "UPCOMING" && !upcoming) return false;
      if (filter === "COMPLETED" && !completed) return false;
      if (filter === "CANCELLED" && !cancelled) return false;
      return !query || [registration.event?.name, registration.team?.name].some((value) => value?.toLocaleLowerCase().includes(query));
    });
    return filtered.sort((a, b) => {
      if (sort === "OLDEST") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (sort === "EVENT_DATE") return dateValue(a.event?.startDate) - dateValue(b.event?.startDate);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [registrations, filter, search, sort]);

  const counts = useMemo(() => {
    const now = Date.now();
    return {
      ALL: registrations.length,
      UPCOMING: registrations.filter((r) => { const end = r.event ? new Date(r.event.endDate).getTime() : Number.NaN; return r.event && r.status !== "CANCELLED" && r.event.status !== "CANCELLED" && r.event.status !== "COMPLETED" && Number.isFinite(end) && end >= now; }).length,
      COMPLETED: registrations.filter((r) => r.status !== "CANCELLED" && r.event?.status === "COMPLETED").length,
      CANCELLED: registrations.filter((r) => r.status === "CANCELLED" || r.event?.status === "CANCELLED").length,
    };
  }, [registrations]);

  return <div className="my-registrations-page">
    <header className="my-registrations-heading">
      <div><p className="participant-eyebrow">YOUR VIBRANT HISTORY</p><h1>My registrations</h1><p>Every event you’ve registered for, in one place.</p></div>
      <button type="button" className="participant-refresh-button" onClick={() => setReload((value) => value + 1)} disabled={loading}>{loading ? "Loading…" : "Refresh"}<span aria-hidden="true">↻</span></button>
    </header>

    <section className="my-registrations-toolbar" aria-label="Filter and sort registrations">
      <div className="my-registration-tabs" role="tablist" aria-label="Registration status">
        {(["ALL", "UPCOMING", "COMPLETED", "CANCELLED"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={filter === item} className={filter === item ? "is-active" : ""} onClick={() => setFilter(item)}>{tabLabel(item)}<span>{counts[item]}</span></button>)}
      </div>
      <div className="my-registration-controls">
        <label className="my-registration-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search events or teams" aria-label="Search registrations" /></label>
        <label className="my-registration-sort"><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="NEWEST">Newest registration</option><option value="OLDEST">Oldest registration</option><option value="EVENT_DATE">Event date</option></select></label>
      </div>
    </section>

    {error && <section className="my-registration-state is-error" role="alert"><span className="discover-state-mark">!</span><h2>Couldn’t load registrations</h2><p>{error}</p><div><button className="participant-button" type="button" onClick={() => setReload((value) => value + 1)}>Try again</button>{error.includes("Sign in") && <Link to="/login">Sign in</Link>}</div></section>}
    {loading && <div className="my-registration-list" aria-label="Loading registrations">{[0, 1, 2].map((item) => <div className="my-registration-skeleton" key={item}><span /><div><i /><i /><i /></div></div>)}</div>}
    {!loading && !error && registrations.length === 0 && <section className="my-registration-state"><span className="discover-state-mark">V</span><h2>Your event story starts here</h2><p>You haven’t registered for an event yet. Explore what’s happening at VIBRANT2K26.</p><Link className="participant-button" to="/events">Explore Events</Link></section>}
    {!loading && !error && registrations.length > 0 && visible.length === 0 && <section className="my-registration-state"><span className="discover-state-mark">⌕</span><h2>No matching registrations</h2><p>Try a different search or status filter.</p><button className="registration-secondary-button" type="button" onClick={() => { setSearch(""); setFilter("ALL"); }}>Clear filters</button></section>}
    {!loading && !error && visible.length > 0 && <section className="my-registration-list" aria-label="Your registrations">{visible.map((registration) => <RegistrationCard key={registration.id} registration={registration} />)}</section>}
  </div>;
}

function RegistrationCard({ registration }: { registration: MyRegistration }) {
  const event = registration.event;
  const isTeam = registration.isTeam;
  const detailsPath = isTeam && registration.isTeamLeader && registration.teamId ? `/teams/${registration.teamId}` : `/registrations/${registration.id}`;
  const canOpenDetails = !isTeam || (registration.isTeamLeader ? Boolean(registration.teamId) : true);
  const eventStatus = event?.status || "UNAVAILABLE";
  const ticketReady = registration.status === "REGISTERED" && eventStatus !== "CANCELLED" && ["VERIFIED", "NOT_REQUIRED"].includes(registration.payment.status) && (!isTeam || (registration.teamStatus === "REGISTERED" && registration.isTeamLeader && Boolean(registration.teamId)));
  return <article className="my-registration-card">
    <Link to={event ? `/events/${event.id}` : "/events"} className="my-registration-poster-link" aria-label={`View ${event?.name || "event"}`}>
      {event?.poster ? <img className="my-registration-poster" src={event.poster} alt={`${event.name} poster`} loading="lazy" onError={(e) => { e.currentTarget.hidden = true; e.currentTarget.nextElementSibling?.removeAttribute("hidden"); }} /> : null}
      <span className="my-registration-poster-fallback" hidden={Boolean(event?.poster)}>VIBRANT<span>2K26</span></span>
    </Link>
    <div className="my-registration-body">
      <div className="my-registration-title-row"><div><span className="participant-category">{event?.category || "EVENT"}</span><h2>{event?.name || "Event details unavailable"}</h2></div><span className={`participant-status-badge ${statusTone(registration.status)}`}>{formatStatus(registration.status)}</span></div>
      <p className="my-registration-when">{event ? `${formatDate(event.startDate)}${event.endDate !== event.startDate ? ` – ${formatDate(event.endDate)}` : ""}` : "Event date unavailable"}{event?.venue ? ` · ${event.venue}` : ""}</p>
      <div className="my-registration-facts"><Fact label="Type" value={isTeam ? `Team${registration.team?.name ? ` · ${registration.team.name}` : ""}${registration.team?.memberCount ? ` · ${registration.team.memberCount} members` : ""}` : "Individual"} /><Fact label="Reference" value={registration.id} /><Fact label="Registered" value={formatDate(registration.createdAt)} />{registration.amount !== null && <Fact label="Amount" value={registration.amount === 0 ? "Free" : formatAmount(registration.amount)} />}</div>
      <div className="my-registration-footer"><div className="my-registration-statuses"><span>Event <StatusBadge value={eventStatus} /></span><span>Payment <StatusBadge value={registration.payment.status} /></span><span>Attendance <AttendanceBadge registration={registration} /></span></div><div className="my-registration-actions"><Link className="my-registration-details-link" to="/my-attendance">Attendance history<span aria-hidden="true">↗</span></Link>{canOpenDetails ? <Link className="my-registration-details-link" to={detailsPath}>{isTeam ? "Team details" : "Registration details"}<span aria-hidden="true">↗</span></Link> : <span className="my-registration-access-note">Team details available to the leader</span>}{ticketReady && <Link className="my-registration-details-link" to={isTeam ? `/teams/${registration.teamId}/tickets` : `/registrations/${registration.id}/ticket`}>Digital ticket<span aria-hidden="true">↗</span></Link>}{registration.certificate?.isIssued && registration.certificate.certificateId && <Link className="my-registration-details-link" to="/my-certificates">View certificate<span aria-hidden="true">↗</span></Link>}</div></div>
    </div>
  </article>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong title={value}>{value}</strong></div>; }
function StatusBadge({ value }: { value: string }) { return <span className={`participant-status-badge ${statusTone(value)}`}>{formatStatus(value)}</span>; }
function AttendanceBadge({ registration }: { registration: MyRegistration }) {
  const value = registration.attendance?.isPresent ? "Attended" : registration.event?.status === "COMPLETED" ? "Not recorded" : registration.event?.status === "CANCELLED" || registration.status === "CANCELLED" ? "Cancelled" : registration.event && new Date(registration.event.endDate).getTime() >= Date.now() ? "Upcoming" : "Unavailable";
  const tone = value === "Attended" ? "badge-success" : value === "Upcoming" ? "badge-warning" : "badge-neutral";
  return <span className={`participant-status-badge ${tone}`}>{value}</span>;
}
function tabLabel(value: Filter) { return value === "ALL" ? "All" : value === "UPCOMING" ? "Upcoming" : value === "COMPLETED" ? "Completed" : "Cancelled"; }
function statusTone(value: string) { return value === "REGISTERED" || value === "VERIFIED" || value === "COMPLETED" ? "badge-success" : value === "PENDING" ? "badge-warning" : value === "CANCELLED" || value === "REJECTED" ? "badge-danger" : "badge-neutral"; }
function formatStatus(value: string) { return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function dateValue(value?: string) { const date = value ? new Date(value).getTime() : Number.NaN; return Number.isFinite(date) ? date : Number.MAX_SAFE_INTEGER; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date); }
function formatAmount(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value); }
