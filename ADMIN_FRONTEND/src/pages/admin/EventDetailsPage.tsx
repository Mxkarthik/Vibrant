import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, CalendarDays, Check, Clock3, MapPin, Pencil, Trash2, Users } from "lucide-react";
import { cancelEvent, completeEvent, deleteEvent, getApiErrorMessage, getEvent, type EventRecord, type EventStatus } from "../../api/events";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import PageHeader from "../../components/admin/PageHeader";
import EventStatusBadge from "../../components/events/EventStatusBadge";
import ConfirmDialog from "../../components/events/ConfirmDialog";

const dateTimeFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });
type ActionType = "cancel" | "complete" | "delete";

export default function EventDetailsPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [action, setAction] = useState<ActionType | null>(null);
  const [working, setWorking] = useState(false);
  const notice = (location.state as { notice?: string } | null)?.notice;
  const requested = (location.state as { requestAction?: ActionType } | null)?.requestAction;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setEvent(await getEvent(id)); }
    catch (requestError) { setError(getApiErrorMessage(requestError, "Event details could not be loaded.")); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (requested && event && (requested === "delete" ? event.status !== "PUBLISHED" && (event.registration.registeredParticipants ?? 0) === 0 : event.status === "PUBLISHED")) {
      setAction(requested);
      navigate(location.pathname, { replace: true, state: notice ? { notice } : null });
    }
  }, [requested, event, location.pathname, navigate, notice]);

  const confirmAction = async () => {
    if (!event || !action) return;
    if (action === "delete") {
      setWorking(true);
      setActionError(null);
      try {
        const result = await deleteEvent(event._id);
        navigate("/admin/events", { replace: true, state: { notice: result.message } });
      } catch (requestError) {
        setActionError(getApiErrorMessage(requestError, "The event could not be deleted."));
        setAction(null);
      } finally { setWorking(false); }
      return;
    }
    if (event.status !== "PUBLISHED") return;
    setWorking(true);
    setActionError(null);
    try {
      const result = action === "cancel" ? await cancelEvent(event._id) : await completeEvent(event._id);
      setEvent(result.event);
      setAction(null);
      navigate(location.pathname, { replace: true, state: { notice: result.message } });
    } catch (requestError) {
      setActionError(getApiErrorMessage(requestError, "The event status could not be updated."));
    } finally { setWorking(false); }
  };

  if (loading) return <div className="event-detail-skeleton"><span /><span /><span /></div>;
  if (error || !event) return <div className="events-error"><div><AlertCircle size={17} /><strong>{error ?? "Event not found"}</strong></div><Button variant="secondary" onClick={() => navigate("/admin/events")}>Back to events</Button></div>;
  const poster = event.poster?.trim();

  return <>
    <PageHeader title={event.name} description={`${titleCase(event.category)} event`} action={<div className="detail-page-actions"><Button variant="quiet" icon={<ArrowLeft size={15} />} onClick={() => navigate("/admin/events")}>All events</Button><Link className="ui-button button-secondary" to={`/admin/events/${event._id}/edit`}><Pencil size={14} /> Edit event</Link></div>} />
    {notice && <div className="event-notice" role="status"><Check size={15} />{notice}</div>}
    {actionError && <div className="event-form-error" role="alert"><AlertCircle size={16} />{actionError}</div>}
    <div className="event-detail-grid">
      <div className="event-detail-primary">
        <Card className="event-detail-hero">
          {poster && <img className="event-detail-poster" src={poster} alt={`${event.name} poster`} onError={element => { element.currentTarget.hidden = true; }} />}
          <div className="event-detail-title-row"><div><span className="event-detail-category">{titleCase(event.category)}</span><h2>{event.name}</h2></div><EventStatusBadge status={event.status} /></div>
          <p className="event-description">{event.description}</p>
        </Card>
        <Card className="event-detail-section">
          <SectionHeading title="Schedule & venue" icon={<CalendarDays size={16} />} />
          <div className="detail-info-grid"><InfoItem icon={<CalendarDays size={15} />} label="Starts" value={formatDateTime(event.startDate)} /><InfoItem icon={<CalendarDays size={15} />} label="Ends" value={formatDateTime(event.endDate)} /><InfoItem icon={<MapPin size={15} />} label="Venue" value={event.venue} /><InfoItem icon={<Clock3 size={15} />} label="Registration deadline" value={formatDateTime(event.registration.deadline)} /></div>
        </Card>
        <Card className="event-detail-section">
          <SectionHeading title="Registration fields" icon={<Users size={16} />} />
          {event.registrationFields?.length ? <div className="detail-fields-list">{[...event.registrationFields].sort((a,b) => a.order - b.order).map(field => <div className="detail-field-row" key={field.fieldId ?? field.fieldKey}><div><strong>{field.label}</strong><small>{field.fieldKey} · {titleCase(field.fieldType)}{field.options?.length ? ` · ${field.options.join(", ")}` : ""}</small></div><span>{field.required ? "Required" : "Optional"}</span></div>)}</div> : <p className="detail-empty-copy">No custom registration fields.</p>}
        </Card>
      </div>
      <aside className="event-detail-side">
        <Card className="event-detail-section"><SectionHeading title="Registration" icon={<Users size={16} />} />
          <div className="registration-detail-mode"><span>Mode</span><strong>{titleCase(event.registration.mode)}</strong></div>
          {event.registration.mode === "TEAM" && <div className="registration-detail-row"><span>Team size</span><strong>{event.registration.minTeamSize}–{event.registration.maxTeamSize} members</strong></div>}
          <div className="registration-detail-row"><span>Registration fee</span><strong>{event.registration.registrationFee === 0 ? "Free" : formatCurrency(event.registration.registrationFee)}</strong></div>
          <div className="capacity-detail"><div><span>Capacity</span><strong>{event.registration.registeredParticipants} <small>/ {event.registration.capacity}</small></strong></div><div className="capacity-track"><span style={{ width: `${event.registration.capacity ? Math.min(100, event.registration.registeredParticipants / event.registration.capacity * 100) : 0}%` }} /></div><small>{Math.max(0, event.registration.capacity - event.registration.registeredParticipants)} places remaining</small></div>
        </Card>
        <Card className="event-detail-section event-lifecycle"><SectionHeading title="Event status" icon={<Check size={16} />} />
          <p>{statusDescription(event.status)}</p>
          {event.status === "PUBLISHED" && <div className="lifecycle-buttons"><Button variant="secondary" className="button-warn-outline" onClick={() => setAction("cancel")}>Cancel event</Button><Button variant="secondary" onClick={() => setAction("complete")}>Mark completed</Button></div>}
          {event.status !== "PUBLISHED" && (event.registration.registeredParticipants ?? 0) === 0 && <div className="lifecycle-buttons"><Button variant="secondary" className="button-danger-outline" icon={<Trash2 size={14} />} onClick={() => setAction("delete")}>Delete event</Button></div>}
          {event.status !== "PUBLISHED" && (event.registration.registeredParticipants ?? 0) > 0 && <p className="event-delete-note">Registration history is attached to this event, so it must be kept for records.</p>}
        </Card>
      </aside>
    </div>
    {action && <ConfirmDialog title={action === "cancel" ? "Cancel this event?" : action === "complete" ? "Mark event as completed?" : "Permanently delete this event?"} description={action === "cancel" ? "The event will be marked cancelled and will no longer be available for registration." : action === "complete" ? "The event will be marked completed. This action cannot be repeated." : "This permanently removes the event. Events with registration or team history cannot be deleted."} confirmLabel={action === "cancel" ? "Cancel event" : action === "complete" ? "Mark completed" : "Delete event"} cancelLabel={action === "delete" ? "Keep event" : "Keep event"} busy={working} onCancel={() => setAction(null)} onConfirm={() => void confirmAction()} />}
  </>;
}

function SectionHeading({ title, icon }: { title: string; icon: React.ReactNode }) { return <div className="detail-section-heading"><span>{icon}</span><h2>{title}</h2></div>; }
function InfoItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="detail-info-item"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>; }
function titleCase(value: string) { return value.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase()); }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : dateTimeFormat.format(date); }
function formatCurrency(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value); }
function statusDescription(status: EventStatus) { if (status === "CANCELLED") return "This event has been cancelled."; if (status === "COMPLETED") return "This event is marked as completed."; return "This event is published and open according to its registration settings."; }
