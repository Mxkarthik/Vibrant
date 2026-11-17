import { useEffect, useState } from "react";
import axios from "axios";
import { Link, useParams } from "react-router-dom";
import { getEventDetails, type EventDetails, type EventRegistrationField } from "../api/eventService";
import { existingRegistrationPath, getEventRegistrationState, useMyRegistrations } from "../hooks/useMyRegistrations";

const categoryLabels: Record<string, string> = {
  TECHNICAL: "Technical",
  CULTURAL: "Cultural",
  WORKSHOP: "Workshops",
  SPORTS: "Sports",
  COMPETITION: "Competitions",
};

type EventLoadError = { kind: "invalid" | "missing" | "unauthorized" | "server"; message: string };

export default function EventDetailsPage() {
  const { eventId } = useParams();
  const [event, setEvent] = useState<EventDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<EventLoadError | null>(null);
  const [posterFailed, setPosterFailed] = useState(false);
  const { registrations, loading: registrationLoading, error: registrationError, refresh: refreshRegistrations } = useMyRegistrations();

  useEffect(() => {
    const controller = new AbortController();
    setEvent(null);
    setError(null);
    setLoading(true);
    setPosterFailed(false);

    if (!eventId) {
      setError({ kind: "invalid", message: "This event link is invalid." });
      setLoading(false);
      return () => controller.abort();
    }

    getEventDetails(eventId, controller.signal)
      .then(setEvent)
      .catch((requestError: unknown) => {
        if (axios.isCancel(requestError)) return;
        const status = axios.isAxiosError(requestError) ? requestError.response?.status : undefined;
        if (status === 400) setError({ kind: "invalid", message: "This event link is invalid." });
        else if (status === 404) setError({ kind: "missing", message: "This event could not be found or is no longer available." });
        else if (status === 401 || status === 403) setError({ kind: "unauthorized", message: "Your participant session may have expired. Sign in again to view event details." });
        else setError({ kind: "server", message: "Event details could not be loaded right now. Please try again." });
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [eventId]);

  if (loading) return <main className="event-detail-loading" aria-live="polite"><Link to="/events" className="event-detail-back">← Back to Events</Link><div className="event-detail-skeleton"><span /><div><i /><i /><i /></div></div><p>Loading event details…</p></main>;
  if (error || !event) return <section className="event-detail-error" role="alert"><span className="discover-state-mark">{error?.kind === "missing" ? "?" : "!"}</span><p className="participant-eyebrow">EVENT DETAILS</p><h1>{error?.kind === "missing" ? "Event unavailable" : error?.kind === "invalid" ? "Invalid event link" : error?.kind === "unauthorized" ? "Sign-in required" : "Couldn’t load this event"}</h1><p>{error?.message || "Event details could not be loaded."}</p><div><Link className="participant-button" to="/events">Back to Events</Link>{error?.kind === "unauthorized" && <Link className="event-detail-secondary-action" to="/login">Sign in</Link>}</div></section>;

  const registrationState = getRegistrationState(event);
  const myRegistrationState = getEventRegistrationState(registrations, event._id);
  const eventProgress = getEventProgress(event);
  const isRegistrationEnabled = registrationState.available && myRegistrationState.kind === "NONE" && !registrationLoading && !registrationError;
  const registration = event.registration;
  const fields = [...(event.registrationFields || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return <article className="event-detail-page">
    <div className="event-detail-breadcrumb"><Link to="/events">← Back to Events</Link><span aria-hidden="true">/</span><span>{categoryLabels[event.category] || event.category}</span></div>

    <header className="event-detail-heading">
      <div><p className="participant-eyebrow">{categoryLabels[event.category] || event.category} · VIBRANT2K26</p><h1>{event.name}</h1><div className="event-detail-badges"><span className={`event-detail-badge ${eventProgress.tone}`}>{eventProgress.label}</span><span className={`event-detail-badge ${registrationState.available ? "is-open" : "is-closed"}`}>{registrationState.label}</span></div></div>
    </header>

    <div className="event-detail-layout">
      <div className="event-detail-main">
        <div className="event-detail-poster">
          {event.poster && !posterFailed ? <img src={event.poster} alt={`${event.name} poster`} onError={() => setPosterFailed(true)} /> : <div className="discover-poster-fallback" aria-label="No event poster available"><span>VIBRANT</span><strong>2K26</strong></div>}
        </div>

        <section className="event-detail-section"><p className="participant-eyebrow">ABOUT THE EVENT</p><h2>Event overview</h2><p className="event-detail-description">{event.description || "Event description is not available."}</p></section>

        <section className="event-detail-section"><p className="participant-eyebrow">WHEN &amp; WHERE</p><h2>Schedule and venue</h2><div className="event-detail-information-grid">
          <InfoItem label="Event dates" value={formatDateRange(event.startDate, event.endDate)} />
          <InfoItem label="Start time" value={formatTime(event.startDate)} />
          <InfoItem label="End time" value={formatTime(event.endDate)} />
          <InfoItem label="Venue" value={event.venue || "Venue to be announced"} />
        </div><p className="event-detail-note">Times are shown in your local timezone{getLocalTimezone() ? ` (${getLocalTimezone()})` : ""}.</p></section>

        {fields.length > 0 && <section className="event-detail-section"><p className="participant-eyebrow">REGISTRATION FORM</p><h2>Information requested</h2><p className="event-detail-section-intro">These are the fields configured for event registration.</p><ul className="event-detail-fields">{fields.map((field) => <RegistrationField key={field.fieldId} field={field} />)}</ul></section>}
      </div>

      <aside className="event-registration-panel" aria-label="Registration information">
        <p className="participant-eyebrow">REGISTRATION</p><h2>Join this event</h2>
        <div className="event-registration-price">{registration.registrationFee === 0 ? "Free" : formatFee(registration.registrationFee)}</div>
        <dl className="event-registration-facts">
          <InfoRow label="Format" value={registration.mode === "TEAM" ? "Team registration" : "Individual registration"} />
          <InfoRow label="Deadline" value={formatDate(registration.deadline)} />
          {registration.mode === "TEAM" && isValidTeamSize(registration.minTeamSize) && <InfoRow label="Team size" value={`${registration.minTeamSize}–${isValidTeamSize(registration.maxTeamSize) ? registration.maxTeamSize : registration.minTeamSize} members`} />}
          {registration.capacity !== undefined && registration.registeredParticipants !== undefined && Number.isFinite(registration.capacity) && Number.isFinite(registration.registeredParticipants) && registration.capacity > 0 && <InfoRow label="Availability" value={`${Math.max(0, registration.capacity - registration.registeredParticipants)} of ${registration.capacity} places remaining`} />}
        </dl>
        <div className={`event-registration-explanation ${isRegistrationEnabled ? "is-available" : ""}`}><strong>{myRegistrationState.kind === "INDIVIDUAL" ? "Already Registered" : myRegistrationState.kind === "TEAM" ? "Team Registered" : myRegistrationState.kind === "CANCELLED" ? "Previous registration" : myRegistrationState.kind === "UNKNOWN_TEAM" ? "Registration status unavailable" : registrationLoading ? "Checking your registration" : registrationError ? "Could not check registration" : registrationState.label}</strong><p>{myRegistrationState.kind === "INDIVIDUAL" ? "Your active individual registration is already recorded." : myRegistrationState.kind === "TEAM" ? "Your active team registration is already recorded." : myRegistrationState.kind === "CANCELLED" ? "A previous registration record exists for this account. Contact the event administrator if you need help registering again." : myRegistrationState.kind === "UNKNOWN_TEAM" ? "A team registration record exists, but its current status could not be confirmed." : registrationLoading ? "Checking your registration before offering this action." : registrationError ? "Registration status could not be checked, so registration is temporarily unavailable." : registrationState.explanation}</p></div>
        {myRegistrationState.kind === "INDIVIDUAL" || myRegistrationState.kind === "TEAM" ? <><button className="event-registration-button is-registered" type="button" disabled>{myRegistrationState.kind === "TEAM" ? "Team Registered" : "Already Registered"}</button><Link className="event-registration-existing-link" to={existingRegistrationPath(myRegistrationState)}>{myRegistrationState.kind === "TEAM" && myRegistrationState.registration.isTeamLeader && myRegistrationState.registration.teamId ? "View Team Details" : "View Registration"} ↗</Link></> : myRegistrationState.kind === "CANCELLED" ? <><button className="event-registration-button" type="button" disabled>Previous Registration</button><Link className="event-registration-existing-link" to={existingRegistrationPath(myRegistrationState)}>View Previous Record ↗</Link></> : myRegistrationState.kind === "UNKNOWN_TEAM" || registrationLoading || Boolean(registrationError) || !registrationState.available ? <button className="event-registration-button" type="button" disabled>{myRegistrationState.kind === "UNKNOWN_TEAM" ? "Registration unavailable" : registrationLoading ? "Checking registration…" : registrationError ? "Status unavailable" : registrationState.label}</button> : <Link className="event-registration-button" to={`/events/${event._id}/${registration.mode === "TEAM" ? "register-team" : "register"}`}>{registration.mode === "TEAM" ? "Register Your Team" : "Register Individually"}</Link>}
        {!registrationError && !registrationLoading && myRegistrationState.kind === "NONE" && <p className="event-registration-footnote">Review the registration details before confirming your place.</p>}
        {Boolean(registrationError) && <button type="button" className="event-registration-retry" onClick={refreshRegistrations}>Retry registration check</button>}
      </aside>
    </div>

    <footer className="event-detail-footer-actions"><div><p className="participant-eyebrow">KEEP EXPLORING</p><h2>Looking for another experience?</h2></div><Link className="participant-button" to="/events">Explore More Events</Link></footer>
  </article>;
}

function InfoItem({ label, value }: { label: string; value: string }) { return <div className="event-detail-info-item"><span>{label}</span><strong>{value}</strong></div>; }
function InfoRow({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }

function RegistrationField({ field }: { field: EventRegistrationField }) {
  return <li><div><strong>{field.label}</strong>{field.required && <span className="event-field-required">Required</span>}</div><p>{formatFieldType(field.fieldType)}{field.options?.length > 0 && <span> · {field.options.join(", ")}</span>}</p></li>;
}

function getRegistrationState(event: EventDetails) {
  if (event.status === "CANCELLED") return { available: false, label: "Event Cancelled", explanation: "This event has been cancelled and is not accepting registrations." };
  if (event.status === "COMPLETED") return { available: false, label: "Event Completed", explanation: "This event has been completed and is not accepting registrations." };
  if (event.status !== "PUBLISHED") return { available: false, label: "Event Unavailable", explanation: "This event is not currently accepting registrations." };
  const { registration } = event;
  const validCapacity = Number.isFinite(registration.capacity) && Number.isFinite(registration.registeredParticipants) && (registration.capacity ?? 0) > 0 && (registration.registeredParticipants ?? -1) >= 0;
  if (!validCapacity) return { available: false, label: "Availability unavailable", explanation: "Registration availability could not be confirmed. Please check back later." };
  const remaining = (registration.capacity ?? 0) - (registration.registeredParticipants ?? 0);
  if (remaining <= 0) return { available: false, label: "Fully Booked", explanation: "All available places have been filled." };
  if (registration.mode === "TEAM" && !isValidTeamSize(registration.minTeamSize)) return { available: false, label: "Availability unavailable", explanation: "The minimum team size is not available, so registration cannot be confirmed." };
  if (registration.mode === "TEAM" && remaining < (registration.minTeamSize ?? 1)) return { available: false, label: "Not enough places for a team", explanation: `At least ${registration.minTeamSize} places are needed for the minimum team size.` };
  const deadline = new Date(registration.deadline);
  if (!Number.isFinite(deadline.getTime())) return { available: false, label: "Availability unavailable", explanation: "The registration deadline could not be confirmed." };
  if (deadline.getTime() <= Date.now()) return { available: false, label: "Registration Closed", explanation: "The registration deadline has passed." };
  return { available: true, label: "Registration Open", explanation: "Registration is open and places remain available." };
}

function getEventProgress(event: EventDetails) {
  if (event.status === "CANCELLED") return { label: "Cancelled", tone: "is-cancelled" };
  if (event.status === "COMPLETED") return { label: "Completed", tone: "is-completed" };
  const start = new Date(event.startDate).getTime();
  const end = new Date(event.endDate).getTime();
  const now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { label: "Schedule unavailable", tone: "is-completed" };
  if (Number.isFinite(start) && now < start) return { label: "Upcoming", tone: "is-upcoming" };
  if (Number.isFinite(end) && now <= end) return { label: "In progress", tone: "is-upcoming" };
  return { label: "Event ended", tone: "is-completed" };
}

function isValidTeamSize(value?: number): value is number { return Number.isFinite(value) && (value ?? 0) >= 1; }
function formatFieldType(value: EventRegistrationField["fieldType"]) { return value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDateRange(startValue: string, endValue: string) { const start = new Date(startValue); const end = new Date(endValue); if (Number.isNaN(start.getTime())) return "Date unavailable"; const first = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(start); return Number.isNaN(end.getTime()) || sameDay(startValue, endValue) ? first : `${first} – ${new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(end)}`; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unavailable" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date); }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date); }
function sameDay(firstValue: string, secondValue: string) { const first = new Date(firstValue); const second = new Date(secondValue); return !Number.isNaN(first.getTime()) && !Number.isNaN(second.getTime()) && first.toDateString() === second.toDateString(); }
function formatFee(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value); }
function getLocalTimezone() { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
