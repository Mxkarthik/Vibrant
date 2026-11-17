import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link, useSearchParams } from "react-router-dom";
import {
  EVENT_CATEGORIES,
  getDiscoverableEvents,
  type DiscoverableEvent,
  type EventCategory,
  type EventFilter,
  type EventSort,
} from "../api/eventService";
import { getEventRegistrationState, existingRegistrationPath, useMyRegistrations } from "../hooks/useMyRegistrations";

const PAGE_SIZE = 9;
const categoryLabels: Record<EventCategory, string> = {
  TECHNICAL: "Technical",
  CULTURAL: "Cultural",
  WORKSHOP: "Workshops",
  SPORTS: "Sports",
  COMPETITION: "Competitions",
};
const validFilters: EventFilter[] = ["", "upcoming", "open", "closing-soon", "free", "paid"];
const validSorts: EventSort[] = ["upcoming", "latest", "name"];

export default function ExploreEventsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchFromUrl = searchParams.get("search") || "";
  const categoryValue = searchParams.get("category") || "";
  const category = EVENT_CATEGORIES.includes(categoryValue as EventCategory) ? categoryValue as EventCategory : "";
  const filterValue = searchParams.get("filter") || "";
  const eventFilter = validFilters.includes(filterValue as EventFilter) ? filterValue as EventFilter : "";
  const sortValue = searchParams.get("sortBy") || "upcoming";
  const sortBy = validSorts.includes(sortValue as EventSort) ? sortValue as EventSort : "upcoming";
  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
  const [searchText, setSearchText] = useState(searchFromUrl);
  const [result, setResult] = useState<Awaited<ReturnType<typeof getDiscoverableEvents>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const { registrations, loading: registrationLoading, error: registrationError, refresh: refreshRegistrations } = useMyRegistrations();

  useEffect(() => setSearchText(searchFromUrl), [searchFromUrl]);

  useEffect(() => {
    if (searchText === searchFromUrl) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (searchText.trim()) next.set("search", searchText.trim());
      else next.delete("search");
      next.set("page", "1");
      setSearchParams(next, { replace: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchText, searchFromUrl, searchParams, setSearchParams]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getDiscoverableEvents({
      search: searchFromUrl || undefined,
      category: category || undefined,
      filter: eventFilter || undefined,
      sortBy,
      page,
      limit: PAGE_SIZE,
    }, controller.signal)
      .then(setResult)
      .catch((requestError: unknown) => {
        if (axios.isCancel(requestError)) return;
        setError(axios.isAxiosError(requestError)
          ? requestError.response?.data?.message || "Events could not be loaded. Please try again."
          : "Events could not be loaded. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [searchFromUrl, category, eventFilter, sortBy, page, retryKey]);

  const updateFilters = (updates: Record<string, string>, resetPage = true) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    if (resetPage) next.set("page", "1");
    setSearchParams(next, { replace: true });
  };

  const total = result?.pagination.totalEvents;
  const pageCount = result?.pagination.totalPages || 0;
  const events = result?.events || [];
  const hasCriteria = Boolean(searchFromUrl || category || eventFilter);
  const rangeLabel = useMemo(() => {
    if (total === undefined) return "";
    if (!total) return "No events found";
    const first = (page - 1) * PAGE_SIZE + 1;
    return `Showing ${first}–${Math.min(page * PAGE_SIZE, total)} of ${total} events`;
  }, [page, total]);

  return <section className="discover-page">
    <header className="discover-heading">
      <div><p className="participant-eyebrow">FIND YOUR NEXT MOMENT</p><h1>Explore Events</h1><p>Browse what’s happening at VIBRANT2K26 and find an experience that speaks to you.</p></div>
      <span className="discover-edition" aria-hidden="true">V2K26</span>
    </header>

    <section className="discover-controls" aria-label="Search and filter events">
      <label className="discover-search"><span aria-hidden="true">⌕</span><span className="visually-hidden">Search events</span><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search events, descriptions or categories" type="search" /></label>
      <div className="discover-filter-row">
        <label>Category <select value={category} onChange={(event) => updateFilters({ category: event.target.value })}>
          <option value="">All events</option>
          {EVENT_CATEGORIES.map((value) => <option key={value} value={value}>{categoryLabels[value]}</option>)}
        </select></label>
        <label>Availability <select value={eventFilter} onChange={(event) => updateFilters({ filter: event.target.value })}>
          <option value="">Any availability</option><option value="upcoming">Upcoming</option><option value="open">Registration open</option><option value="closing-soon">Closing in 7 days</option><option value="free">Free events</option><option value="paid">Paid events</option>
        </select></label>
        <label>Sort by <select value={sortBy} onChange={(event) => updateFilters({ sortBy: event.target.value })}>
          <option value="upcoming">Upcoming first</option><option value="latest">Latest added</option><option value="name">Name A–Z</option>
        </select></label>
      </div>
    </section>

    <div className="discover-results-line"><span>{rangeLabel || "Loading events…"}</span>{hasCriteria && <button type="button" onClick={() => { setSearchText(""); setSearchParams(new URLSearchParams({ page: "1", sortBy }), { replace: true }); }}>Clear filters</button>}</div>

    {error ? <div className="discover-state discover-error" role="alert"><span className="discover-state-mark">!</span><h2>Events aren’t available right now</h2><p>{error}</p><button className="participant-button" type="button" onClick={() => setRetryKey((key) => key + 1)}>Try again</button></div>
      : loading ? <div className="discover-grid" aria-label="Loading events">{Array.from({ length: 6 }, (_, index) => <div className="discover-card-skeleton" key={index}><span /><div><i /><i /><i /></div></div>)}</div>
        : events.length === 0 ? <div className="discover-state"><span className="discover-state-mark">✳</span><h2>{hasCriteria ? "No events match those filters" : "No published events yet"}</h2><p>{hasCriteria ? "Try another search or clear some filters to see more events." : "Published VIBRANT2K26 events will appear here when they’re available."}</p>{hasCriteria && <button type="button" className="participant-button" onClick={() => { setSearchText(""); setSearchParams(new URLSearchParams({ page: "1", sortBy }), { replace: true }); }}>Clear filters</button>}</div>
          : <>{registrationError && <div className="discover-registration-warning" role="status"><span>Registration status could not be checked, so registration actions are temporarily unavailable.</span><button type="button" onClick={refreshRegistrations}>Retry</button></div>}<div className="discover-grid">{events.map((event) => <EventCard key={event._id} event={event} registrationState={getEventRegistrationState(registrations, event._id)} registrationLoading={registrationLoading} registrationError={Boolean(registrationError)} />)}</div></>}

    {!error && !loading && pageCount > 1 && <nav className="discover-pagination" aria-label="Event pages">
      <button type="button" disabled={!result?.pagination.hasPreviousPage} onClick={() => updateFilters({ page: String(page - 1) }, false)}>← Previous</button>
      <span>Page {result?.pagination.currentPage} of {pageCount}</span>
      <button type="button" disabled={!result?.pagination.hasNextPage} onClick={() => updateFilters({ page: String(page + 1) }, false)}>Next →</button>
    </nav>}
  </section>;
}

function EventCard({ event, registrationState, registrationLoading, registrationError }: { event: DiscoverableEvent; registrationState: ReturnType<typeof getEventRegistrationState>; registrationLoading: boolean; registrationError: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const registration = event.registration;
  const hasCapacityData = Number.isFinite(registration.registeredParticipants) && Number.isFinite(registration.capacity) && (registration.capacity ?? 0) > 0;
  const remainingCapacity = hasCapacityData ? (registration.capacity ?? 0) - (registration.registeredParticipants ?? 0) : 0;
  const isFull = hasCapacityData && remainingCapacity <= 0;
  const teamConfigurationValid = registration.mode !== "TEAM" || Number.isFinite(registration.minTeamSize) && (registration.minTeamSize ?? 0) >= 1;
  const enoughPlacesForTeam = registration.mode !== "TEAM" || teamConfigurationValid && remainingCapacity >= (registration.minTeamSize ?? Number.POSITIVE_INFINITY);
  const deadline = new Date(registration.deadline);
  const isOpen = hasCapacityData && teamConfigurationValid && enoughPlacesForTeam && Number.isFinite(deadline.getTime()) && deadline.getTime() > Date.now() && !isFull;
  const availability = event.status === "CANCELLED" ? "Cancelled"
    : event.status === "COMPLETED" ? "Completed"
      : !hasCapacityData || !teamConfigurationValid ? "Availability unavailable" : isFull ? "Fully booked" : !enoughPlacesForTeam ? "Not enough places for a team" : isOpen ? "Registration open" : "Registration closed";
  const tone = availability === "Registration open" ? "is-open" : availability === "Fully booked" ? "is-full" : "is-closed";

  return <article className="discover-card">
    <div className="discover-card-image">
      {event.poster && !imageFailed ? (
        <img
          src={event.poster}
          alt={`${event.name} poster`}
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="discover-poster-fallback" aria-label="No event poster available">
          <span>VIBRANT</span>
          <strong>2K26</strong>
        </div>
      )}
    </div>
    <div className="discover-card-content">
      <div className="discover-card-meta">
        <div className="discover-meta-tags">
          <span className="discover-category-tag">{categoryLabels[event.category] || event.category}</span>
          <span className="discover-meta-separator">·</span>
          <span className="discover-mode-tag">{registration.mode === "TEAM" ? "Team event" : "Individual event"}</span>
        </div>
        <span className={`discover-availability ${tone}`}>{availability}</span>
      </div>
      <h2>{event.name}</h2>
      <p className="discover-description">{event.description}</p>
      <dl className="discover-event-facts">
        <div><dt>Date</dt><dd>{formatDateRange(event.startDate, event.endDate)}</dd></div>
        <div><dt>Time</dt><dd>{formatTime(event.startDate)}{sameDay(event.startDate, event.endDate) ? ` – ${formatTime(event.endDate)}` : ` · Ends ${formatTime(event.endDate)}`}</dd></div>
        <div><dt>Venue</dt><dd>{event.venue || "Venue to be announced"}</dd></div>
        <div><dt>Fee</dt><dd>{registration.registrationFee === 0 ? "Free" : formatFee(registration.registrationFee)}</dd></div>
      </dl>
      <div className="discover-card-deadline">
        <span>Registration deadline</span>
        <strong>{formatDate(registration.deadline)}</strong>
      </div>
      <div className="discover-card-actions">
        <div className="discover-primary-action">
          {registrationState.kind === "INDIVIDUAL" || registrationState.kind === "TEAM"
            ? <><button className="discover-register-button is-registered" type="button" disabled>{registrationState.kind === "TEAM" ? "Team Registered" : "Already Registered"}</button><Link className="discover-registered-link" to={existingRegistrationPath(registrationState)}>{registrationState.kind === "TEAM" && registrationState.registration.isTeamLeader && registrationState.registration.teamId ? "View team" : "View registration"}<span aria-hidden="true">↗</span></Link></>
            : registrationState.kind === "CANCELLED"
              ? <><button className="discover-register-button" type="button" disabled>Previous Registration</button><Link className="discover-registered-link" to={existingRegistrationPath(registrationState)}>View record<span aria-hidden="true">↗</span></Link></>
              : registrationState.kind === "UNKNOWN_TEAM"
                ? <><button className="discover-register-button" type="button" disabled>Registration unavailable</button><Link className="discover-registered-link" to="/my-registrations">My Registrations<span aria-hidden="true">↗</span></Link></>
                : registrationLoading || registrationError || !isOpen
                  ? <button className="discover-register-button" type="button" disabled>{registrationLoading ? "Checking registration…" : registrationError ? "Status unavailable" : availability}</button>
                  : <Link className="discover-register-button" to={`/events/${event._id}/${registration.mode === "TEAM" ? "register-team" : "register"}`}>{registration.mode === "TEAM" ? "Register Your Team" : "Register Individually"}<span aria-hidden="true">→</span></Link>}
        </div>
        <Link className="discover-details-link" to={`/events/${event._id}`}>View details <span aria-hidden="true">↗</span></Link>
      </div>
    </div>
  </article>;
}

function formatDateRange(startValue: string, endValue: string) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime())) return "Date unavailable";
  const startDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(start);
  if (Number.isNaN(end.getTime()) || sameDay(startValue, endValue)) return startDate;
  return `${startDate} – ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(end)}`;
}
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unavailable" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date); }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date); }
function sameDay(start: string, end: string) { const first = new Date(start); const last = new Date(end); return !Number.isNaN(first.getTime()) && !Number.isNaN(last.getTime()) && first.toDateString() === last.toDateString(); }
function formatFee(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value); }
