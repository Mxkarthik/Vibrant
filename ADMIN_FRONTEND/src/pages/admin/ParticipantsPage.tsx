import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CalendarDays, ChevronLeft, ChevronRight, Download, Eye, Mail, Phone, Search, Users, X } from "lucide-react";
import { downloadParticipantExport, getEventParticipants, getParticipantEvents, getRegistrationDetails, type ParticipantFilters, type ParticipantPaymentStatus, type ParticipantRegistration, type ParticipantRegistrationStatus, type RegistrationDetailsResult } from "../../api/participants";
import { getApiErrorMessage } from "../../api/events";
import type { EventRecord } from "../../api/events";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import PageHeader from "../../components/admin/PageHeader";

const initialFilters: ParticipantFilters = { page: 1, limit: 20, search: "", type: "", paymentStatus: "", attendance: "", status: "REGISTERED" };
const numberFormat = new Intl.NumberFormat("en-IN");

export default function ParticipantsPage() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState(initialFilters);
  const [rows, setRows] = useState<ParticipantRegistration[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const selectedEvent = useMemo(() => events.find(event => event._id === selectedEventId), [events, selectedEventId]);
  const hasActiveFilters = Boolean(filters.search || filters.type || filters.paymentStatus || filters.attendance || filters.status !== "REGISTERED");

  const loadEvents = useCallback(async () => {
    setEventsLoading(true); setEventsError(null);
    try {
      const result = await getParticipantEvents();
      setEvents(result);
      setSelectedEventId(current => current || result[0]?._id || "");
    } catch (requestError) { setEventsError(getApiErrorMessage(requestError, "Events could not be loaded.")); }
    finally { setEventsLoading(false); }
  }, []);
  useEffect(() => { void loadEvents(); }, [loadEvents]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setFilters(current => ({ ...current, search: searchInput.trim(), page: 1 })), 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const loadParticipants = useCallback(async () => {
    if (!selectedEventId) { setRows([]); setTotal(0); setTotalPages(0); return; }
    setLoading(true); setError(null);
    try {
      const result = await getEventParticipants(selectedEventId, filters);
      setRows(result.registrations); setTotal(result.pagination.total); setTotalPages(result.pagination.totalPages);
    } catch (requestError) { setError(getApiErrorMessage(requestError, "Participants could not be loaded.")); }
    finally { setLoading(false); }
  }, [selectedEventId, filters]);
  useEffect(() => { void loadParticipants(); }, [loadParticipants]);

  const updateFilter = <K extends keyof ParticipantFilters>(key: K, value: ParticipantFilters[K]) => setFilters(current => ({ ...current, [key]: value, page: 1 }));

  const exportParticipants = async () => {
    if (!selectedEvent) return;
    setExporting(true); setExportError(null);
    try {
      const response = await downloadParticipantExport(selectedEvent._id);
      const objectUrl = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `VIBRANT_${selectedEvent.name.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}_Participants.xlsx`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (requestError) {
      const responseData = (requestError as { response?: { data?: Blob } })?.response?.data;
      let message = getApiErrorMessage(requestError, "Excel export failed. Please try again.");
      if (responseData instanceof Blob) {
        try { const body = JSON.parse(await responseData.text()); if (body.message) message = body.message; } catch { /* Keep the fallback. */ }
      }
      setExportError(message);
    } finally { setExporting(false); }
  };

  return <>
    <PageHeader title="Participants" description="Review event registrations, participant details and team membership." action={<Button variant="secondary" icon={<Download size={15} />} onClick={() => void exportParticipants()} disabled={!selectedEvent || exporting}>{exporting ? "Preparing…" : "Export Excel"}</Button>} />
    {exportError && <div className="participant-alert" role="alert">{exportError}</div>}
    {eventsError ? <Card className="participant-state"><p>{eventsError}</p><Button variant="secondary" onClick={() => void loadEvents()}>Try again</Button></Card> : <Card className="participant-card">
      <div className="participant-toolbar">
        <label className="participant-event-select"><span>Event</span><select aria-label="Select event" value={selectedEventId} disabled={eventsLoading || !events.length} onChange={event => { setSelectedEventId(event.target.value); setFilters(initialFilters); setSearchInput(""); }}><option value="">{eventsLoading ? "Loading events…" : events.length ? "Select an event" : "No events available"}</option>{events.map(event => <option key={event._id} value={event._id}>{event.name} · {numberFormat.format(event.registration?.registeredParticipants ?? 0)} registered</option>)}</select></label>
        <label className="participant-search"><Search size={15} /><input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Search name, email, college, team…" aria-label="Search participants" /></label>
      </div>
      <div className="participant-filters">
        <select aria-label="Filter registration type" value={filters.type} onChange={event => updateFilter("type", event.target.value as ParticipantFilters["type"])}><option value="">All registration types</option><option value="INDIVIDUAL">Individual</option><option value="TEAM">Team</option></select>
        <select aria-label="Filter payment status" value={filters.paymentStatus} onChange={event => updateFilter("paymentStatus", event.target.value as ParticipantPaymentStatus)}><option value="">All payment statuses</option><option value="PENDING">Pending</option><option value="VERIFIED">Verified</option><option value="REJECTED">Rejected</option><option value="NOT_REQUIRED">Not required</option></select>
        <select aria-label="Filter attendance" value={filters.attendance} onChange={event => updateFilter("attendance", event.target.value as ParticipantFilters["attendance"])}><option value="">All attendance</option><option value="PRESENT">Checked in</option><option value="ABSENT">Not checked in</option></select>
        <select aria-label="Filter registration status" value={filters.status} onChange={event => updateFilter("status", event.target.value as ParticipantRegistrationStatus)}><option value="REGISTERED">Registered</option><option value="CANCELLED">Cancelled</option><option value="ALL">All registrations</option></select>
      </div>
      {!selectedEventId && !eventsLoading ? <div className="participant-state"><span className="participant-state-icon"><Users size={19} /></span><h2>{events.length ? "Choose an event" : "No events found"}</h2><p>{events.length ? "Select an event above to view its registrations." : "Events will appear here when they are available."}</p></div>
        : error ? <div className="participant-state"><h2>Could not load participants</h2><p>{error}</p><Button variant="secondary" onClick={() => void loadParticipants()}>Try again</Button></div>
        : loading ? <ParticipantSkeleton />
        : !rows.length ? <div className="participant-state"><span className="participant-state-icon"><Users size={19} /></span><h2>{hasActiveFilters ? "No matching registrations" : "No registrations yet"}</h2><p>{hasActiveFilters ? "Change or clear the filters to see more participants." : "Registrations for this event will appear here."}</p></div>
        : <>
          <div className="participant-table-wrap"><table className="participant-table"><thead><tr><th>Participant</th><th>Registration</th><th>Payment</th><th>Attendance</th><th>Registered</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{rows.map(row => <ParticipantRow key={row._id} row={row} onDetails={() => setDetailId(row._id)} />)}</tbody></table></div>
          <div className="participant-pagination"><span>{numberFormat.format(total)} registrations · Page {filters.page} of {Math.max(totalPages, 1)}</span><div><label>Rows <select aria-label="Rows per page" value={filters.limit} onChange={event => updateFilter("limit", Number(event.target.value))}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label><Button variant="secondary" icon={<ChevronLeft size={15} />} onClick={() => setFilters(current => ({ ...current, page: Math.max(1, current.page - 1) }))} disabled={filters.page <= 1 || loading}>Previous</Button><Button variant="secondary" onClick={() => setFilters(current => ({ ...current, page: current.page + 1 }))} disabled={filters.page >= totalPages || loading}>Next <ChevronRight size={15} /></Button></div></div>
        </>}
    </Card>}
    {detailId && <RegistrationDrawer registrationId={detailId} onClose={() => setDetailId(null)} />}
  </>;
}

function ParticipantRow({ row, onDetails }: { row: ParticipantRegistration; onDetails: () => void }) {
  const details = row.participantDetails;
  const isTeam = Boolean(row.team);
  const payment = isTeam ? row.team?.payment?.status : row.payment?.status;
  const leader = typeof row.team?.leader === "object" ? row.team.leader?.name : null;
  return <tr>
    <td><div className="participant-identity"><span className="participant-avatar">{(details?.fullName || row.user?.name || "P").trim().charAt(0).toUpperCase()}</span><div><strong>{details?.fullName || row.user?.name || "Name unavailable"}</strong><small>{row.user?.email || "Email unavailable"}</small><small>{details?.mobileNumber || "Mobile unavailable"}</small></div></div></td>
    <td><span className={`participant-type ${isTeam ? "team" : "individual"}`}>{isTeam ? "Team member" : "Individual"}</span><small className="participant-team-meta">{row.status ? formatStatus(row.status) : "Status unavailable"}</small>{isTeam && <small className="participant-team-meta">{row.team?.teamName || "Team"} · {row.isTeamLeader ? "Team leader" : leader ? `Leader: ${leader}` : `${row.team?.memberCount ?? "—"} members`}</small>}</td>
    <td><StatusPill value={payment || "UNKNOWN"} /></td><td><StatusPill value={row.attendance?.isPresent ? "PRESENT" : "ABSENT"} /></td><td>{formatDate(row.createdAt)}</td>
    <td><button className="participant-detail-button" onClick={onDetails} aria-label={`View details for ${details?.fullName || row.user?.name || "participant"}`}><Eye size={16} /></button></td>
  </tr>;
}

function RegistrationDrawer({ registrationId, onClose }: { registrationId: string; onClose: () => void }) {
  const [result, setResult] = useState<RegistrationDetailsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setResult(await getRegistrationDetails(registrationId)); }
    catch (requestError) { setError(getApiErrorMessage(requestError, "Registration details could not be loaded.")); }
    finally { setLoading(false); }
  }, [registrationId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose]);

  const registration = result?.registration;
  const details = registration?.participantDetails;
  const team = registration?.team;
  const teamLeader = typeof team?.leader === "object" ? team.leader : null;
  return <div className="participant-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><aside className="participant-drawer" role="dialog" aria-modal="true" aria-labelledby="participant-drawer-title">
    <header><div><p>REGISTRATION DETAILS</p><h2 id="participant-drawer-title">{details?.fullName || registration?.user?.name || (loading ? "Loading details…" : "Participant")}</h2></div><button className="participant-drawer-close" onClick={onClose} aria-label="Close details"><X size={18} /></button></header>
    {loading ? <ParticipantSkeleton /> : error ? <div className="participant-state"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>Try again</Button></div> : registration && <div className="participant-drawer-content">
      <DetailSection title="Participant information"><Detail label="Email" value={registration.user?.email} icon={<Mail size={14} />} /><Detail label="Mobile" value={details?.mobileNumber} icon={<Phone size={14} />} /><Detail label="College" value={details?.collegeName} icon={<Building2 size={14} />} /><Detail label="Department" value={details?.department} /><Detail label="Section" value={details?.section} /><Detail label="Year of study" value={details?.yearOfStudy} /><Detail label="Roll number" value={details?.rollNumber} /></DetailSection>
      <DetailSection title="Event & registration"><Detail label="Event" value={registration.event?.name} icon={<CalendarDays size={14} />} /><Detail label="Category" value={registration.event?.category} /><Detail label="Venue" value={registration.event?.venue} /><Detail label="Registration type" value={team ? "Team" : "Individual"} /><Detail label="Registration status" value={registration.status} /><Detail label="Registered" value={formatDate(registration.createdAt)} /></DetailSection>
      {team && <DetailSection title="Team"><Detail label="Team name" value={team.teamName} icon={<Users size={14} />} /><Detail label="Team leader" value={teamLeader?.name || (registration.isTeamLeader ? details?.fullName : undefined)} /><Detail label="Member count" value={team.memberCount?.toString()} /><Detail label="Shared payment" value={team.payment?.status} />{result.teamMembers?.length ? <div className="team-members"><strong>Team members</strong>{result.teamMembers.map((member, index) => <div key={`${member.email || member.name}-${index}`}><span>{member.name}{member.isTeamLeader ? " · Leader" : ""}</span><small>{member.email || "Email unavailable"}</small></div>)}</div> : null}</DetailSection>}
      <DetailSection title="Payment & attendance"><Detail label="Payment method" value={team ? "Shared by team" : registration.payment?.method} /><Detail label="Payment status" value={team ? team.payment?.status : registration.payment?.status} /><Detail label="Attendance" value={registration.attendance?.isPresent ? "Checked in" : "Not checked in"} /><Detail label="Check-in time" value={formatDate(registration.attendance?.checkedInAt)} /></DetailSection>
      {registration.customResponses?.length ? <DetailSection title="Custom responses">{registration.customResponses.map((response, index) => <Detail key={`${response.fieldKey}-${index}`} label={response.fieldKey || "Response"} value={formatValue(response.value)} />)}</DetailSection> : null}
      <DetailSection title="Certificate"><Detail label="Issued" value={registration.certificate?.isIssued ? "Yes" : "No"} /><Detail label="Certificate ID" value={registration.certificate?.certificateId} /><Detail label="Issued date" value={formatDate(registration.certificate?.issuedAt)} /></DetailSection>
    </div>}
  </aside></div>;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="participant-detail-section"><h3>{title}</h3><div>{children}</div></section>; }
function Detail({ label, value, icon }: { label: string; value?: string | null; icon?: React.ReactNode }) { return <div className="participant-detail-item">{icon}<span>{label}</span><strong>{value || "—"}</strong></div>; }
function StatusPill({ value }: { value: string }) { const key = value.toLowerCase().replace(/_/g, "-"); return <span className={`participant-status status-${key}`}>{formatStatus(value)}</span>; }
function ParticipantSkeleton() { return <div className="participant-skeleton" aria-label="Loading participants">{[0, 1, 2, 3, 4].map(item => <span key={item} />)}</div>; }
function formatStatus(value: string) { return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase()); }
function formatDate(value?: string | null) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", ...(value.includes("T") ? { timeStyle: "short" as const } : {}) }).format(date); }
function formatValue(value: unknown): string { if (value === null || value === undefined || value === "") return "—"; if (Array.isArray(value)) return value.map(formatValue).join(", "); if (typeof value === "object") return JSON.stringify(value); return String(value); }
