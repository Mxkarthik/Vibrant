import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Eye, MoreHorizontal, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { getAdminEvents, getApiErrorMessage, type EventCategory, type EventListResult, type EventStatus } from "../../api/events";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import PageHeader from "../../components/admin/PageHeader";
import EventStatusBadge from "../../components/events/EventStatusBadge";
import "../../components/events/multiEventAccess.css";

const categories: EventCategory[] = ["TECHNICAL", "CULTURAL", "SPORTS", "WORKSHOP", "COMPETITION"];
const statuses: EventStatus[] = ["PUBLISHED", "CANCELLED", "COMPLETED"];
const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function EventsPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<EventStatus | "">("");
  const [category, setCategory] = useState<EventCategory | "">("");
  const [sortBy, setSortBy] = useState<"createdAt" | "startDate">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<EventListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageFailures, setImageFailures] = useState<string[]>([]);
  const location = useLocation();
  const navigate = useNavigate();
  const notice = (location.state as { notice?: string } | null)?.notice;

  useEffect(() => {
    const timeout = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await getAdminEvents({ search, status, category, page, limit: 10, sortBy, sortOrder }));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Events could not be loaded. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  }, [search, status, category, page, sortBy, sortOrder]);
  useEffect(() => { void load(); }, [load]);

  const pagination = result?.pagination;
  return <>
    <PageHeader title="Events" description="Create, review and coordinate events across your institution." action={<Link className="ui-button button-primary create-event-link" to="/admin/events/new"><Plus size={15} /> Create event</Link>} />
    {notice && <div className="event-notice" role="status">{notice}</div>}
    <Card className="event-list-card">
      <div className="event-list-toolbar">
        <label className="event-search"><Search size={16} /><input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Search events by name" aria-label="Search events by name" /></label>
        <div className="event-filter-group"><SlidersHorizontal size={15} />
          <select aria-label="Filter by status" value={status} onChange={event => { setStatus(event.target.value as EventStatus | ""); setPage(1); }}><option value="">All statuses</option>{statuses.map(item => <option key={item} value={item}>{titleCase(item)}</option>)}</select>
          <select aria-label="Filter by category" value={category} onChange={event => { setCategory(event.target.value as EventCategory | ""); setPage(1); }}><option value="">All categories</option>{categories.map(item => <option key={item} value={item}>{titleCase(item)}</option>)}</select>
          <select aria-label="Sort events" value={`${sortBy}:${sortOrder}`} onChange={event => { const [field, direction] = event.target.value.split(":") as ["createdAt" | "startDate", "asc" | "desc"]; setSortBy(field); setSortOrder(direction); setPage(1); }}><option value="createdAt:desc">Newest created</option><option value="createdAt:asc">Oldest created</option><option value="startDate:asc">Event date (earliest)</option><option value="startDate:desc">Event date (latest)</option></select>
        </div>
      </div>
      {error ? <div className="events-error"><div><strong>Could not load events</strong><p>{error}</p></div><Button variant="secondary" onClick={() => void load()}>Try again</Button></div>
        : loading && !result ? <EventListSkeleton />
        : result && result.events.length === 0 ? <div className="events-empty"><span className="events-empty-icon"><CalendarDays size={20} /></span><h2>{search || status || category ? "No matching events" : "No events yet"}</h2><p>{search || status || category ? "Try changing the search or filters." : "Create your first event to begin managing your campus programme."}</p>{!search && !status && !category && <Link className="ui-button button-primary" to="/admin/events/new"><Plus size={15} /> Create event</Link>}</div>
        : <>
          <div className="event-table-wrap"><table className="event-table"><thead><tr><th>Event</th><th>Event date</th><th>Venue</th><th>Registration</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
            {result?.events.map(event => <tr key={event._id}>
              <td><div className="event-list-identity">{event.poster && !imageFailures.includes(event._id) ? <img className="event-list-poster" src={event.poster} alt="" loading="lazy" onError={() => setImageFailures(current => [...current, event._id])} /> : <span className="event-list-poster event-poster-fallback"><CalendarDays size={17} /></span>}<div className="event-list-name"><Link to={`/admin/events/${event._id}`}>{event.name}</Link><small>{titleCase(event.category)}</small></div></div></td>
              <td>{formatDate(event.startDate)}</td><td className="event-table-venue">{event.venue}</td><td><span className="registration-mode-label">{titleCase(event.registration.mode)}</span>{event.multiEventAccess?.enabled && <span className="combo-pass-badge">Combo Pass</span>}<small className="registered-count">{event.registration.registeredParticipants} / {event.registration.capacity} registered</small></td><td><EventStatusBadge status={event.status} /></td>
              <td><details className="event-action-menu"><summary aria-label={`Actions for ${event.name}`}><MoreHorizontal size={18} /></summary><div className="event-action-popover"><Link to={`/admin/events/${event._id}`}><Eye size={14} /> View details</Link><Link to={`/admin/events/${event._id}/edit`}><Pencil size={14} /> Edit event</Link>{event.multiEventAccess?.enabled !== true ? <Link to={`/admin/events/${event._id}/domains`}>Domains</Link> : <span className="event-action-disabled" title="Combo Pass parent events cannot have domain lotteries">Domains unavailable for Combo Pass</span>}{event.status === "PUBLISHED" && <button onClick={() => navigate(`/admin/events/${event._id}`, { state: { requestAction: "cancel" } })}>Cancel event</button>}{event.status === "PUBLISHED" && <button onClick={() => navigate(`/admin/events/${event._id}`, { state: { requestAction: "complete" } })}>Mark completed</button>}{event.status !== "PUBLISHED" && (event.registration.registeredParticipants ?? 0) === 0 && <button className="event-delete-action" onClick={() => navigate(`/admin/events/${event._id}`, { state: { requestAction: "delete" } })}><Trash2 size={14} /> Delete event</button>}</div></details></td>
            </tr>)}
          </tbody></table></div>
          <div className="event-pagination"><span>{pagination?.totalEvents ? `Showing ${(page - 1) * (pagination?.limit ?? 10) + 1}–${Math.min(page * (pagination?.limit ?? 10), pagination.totalEvents)} of ${pagination.totalEvents} events` : "No events"}</span><div><Button variant="secondary" icon={<ChevronLeft size={15} />} onClick={() => setPage(current => Math.max(1, current - 1))} disabled={!pagination?.hasPreviousPage || loading}>Previous</Button><span>Page {page} of {Math.max(1, pagination?.totalPages ?? 1)}</span><Button variant="secondary" onClick={() => setPage(current => current + 1)} disabled={!pagination?.hasNextPage || loading}>Next <ChevronRight size={15} /></Button></div></div>
        </>}
    </Card>
  </>;
}

function EventListSkeleton() { return <div className="event-list-skeleton" aria-label="Loading events">{[0, 1, 2, 3].map(row => <div key={row}><span /><span /><span /><span /></div>)}</div>; }
function titleCase(value: string) { return value.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase()); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date); }
