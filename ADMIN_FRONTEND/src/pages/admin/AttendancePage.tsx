import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Download, RefreshCw, Search, Users } from "lucide-react";
import { downloadAttendanceExport, eventExportFilename, getAttendanceEvents, getAttendanceReport, type AttendanceParams, type AttendanceParticipant, type AttendanceReport } from "../../api/attendance";
import { getApiErrorMessage } from "../../api/events";
import type { EventRecord } from "../../api/events";
import AttendanceScanner from "../../components/attendance/AttendanceScanner";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import PageHeader from "../../components/admin/PageHeader";

const numberFormat = new Intl.NumberFormat("en-IN");
const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });
const dateTimeFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });
const initialParams: AttendanceParams = { page: 1, limit: 20, search: "", attendance: "ALL" };

export default function AttendancePage() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [eventId, setEventId] = useState("");
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [params, setParams] = useState(initialParams);
  const [report, setReport] = useState<AttendanceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const selectedEvent = useMemo(() => events.find(event => event._id === eventId), [events, eventId]);
  const currentReport = report?.event._id === eventId ? report : null;

  const loadEvents = useCallback(async () => {
    setEventsLoading(true); setEventsError(null);
    try {
      const result = await getAttendanceEvents();
      setEvents(result);
      setEventId(current => current || result.find(event => event.status === "PUBLISHED")?._id || result[0]?._id || "");
    } catch (requestError) { setEventsError(getApiErrorMessage(requestError, "Events could not be loaded.")); }
    finally { setEventsLoading(false); }
  }, []);
  useEffect(() => { void loadEvents(); }, [loadEvents]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setParams(current => ({ ...current, search: searchInput.trim(), page: 1 })), 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const loadAttendance = useCallback(async () => {
    if (!eventId) { setReport(null); setError(null); setLoading(false); return; }
    setLoading(true); setError(null);
    try { setReport(await getAttendanceReport(eventId, params)); }
    catch (requestError) { setError(getApiErrorMessage(requestError, "Attendance records could not be loaded.")); }
    finally { setLoading(false); }
  }, [eventId, params]);
  useEffect(() => { void loadAttendance(); }, [loadAttendance]);

  const updateFilter = <K extends keyof AttendanceParams>(key: K, value: AttendanceParams[K]) => setParams(current => ({ ...current, [key]: value, page: 1 }));

  const exportAttendance = async () => {
    if (!selectedEvent) return;
    setExporting(true); setExportError(null);
    try {
      const response = await downloadAttendanceExport(selectedEvent._id);
      const objectUrl = URL.createObjectURL(response.data);
      const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.download = eventExportFilename(selectedEvent.name);
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (requestError) {
      const responseData = (requestError as { response?: { data?: Blob } })?.response?.data;
      let message = getApiErrorMessage(requestError, "Attendance export failed. Please try again.");
      if (responseData instanceof Blob) { try { const body = JSON.parse(await responseData.text()); if (body.message) message = body.message; } catch { /* Keep fallback message. */ } }
      setExportError(message);
    } finally { setExporting(false); }
  };

  const refresh = async () => { await Promise.all([loadAttendance(), loadEvents()]); };

  return <>
    <PageHeader title="Attendance" description="Monitor event check-ins and record attendance from participant QR codes." action={<div className="attendance-header-actions"><Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void refresh()} disabled={loading || eventsLoading}>Refresh</Button><Button variant="secondary" icon={<Download size={14} />} onClick={() => void exportAttendance()} disabled={!selectedEvent || exporting}>{exporting ? "Preparing…" : "Export Excel"}</Button></div>} />
    {eventsError ? <Card className="attendance-state"><h2>Events could not be loaded</h2><p>{eventsError}</p><Button variant="secondary" onClick={() => void loadEvents()}>Try again</Button></Card> : <>
      <Card className="attendance-event-picker"><label><span>Selected event</span><select aria-label="Select attendance event" value={eventId} disabled={eventsLoading || !events.length} onChange={event => { setEventId(event.target.value); setParams(initialParams); setSearchInput(""); }}><option value="">{eventsLoading ? "Loading events…" : events.length ? "Select an event" : "No events available"}</option>{events.map(event => <option value={event._id} key={event._id}>{event.name} · {formatDate(event.startDate)} · {titleCase(event.status)}</option>)}</select></label>
        {selectedEvent && <div className="attendance-event-meta"><span><CalendarDays size={14} />{formatDate(selectedEvent.startDate)}{selectedEvent.endDate && selectedEvent.endDate !== selectedEvent.startDate ? ` – ${formatDate(selectedEvent.endDate)}` : ""}</span><span className={`attendance-event-status event-${selectedEvent.status.toLowerCase()}`}>{titleCase(selectedEvent.status)}</span></div>}
      </Card>
      {eventId ? <>
        {loading && !currentReport ? <AttendanceMetricsSkeleton /> : error ? <div className="attendance-error" role="alert"><div><strong>Could not load attendance</strong><p>{error}</p></div><Button variant="secondary" onClick={() => void loadAttendance()}>Try again</Button></div> : currentReport && <>
          <div className="attendance-metric-grid">
            <MetricCard title="Registered participants" value={currentReport.statistics.totalParticipants} icon={<Users size={16} />} tone="blue" />
            <MetricCard title="Checked in" value={currentReport.statistics.present} icon={<CheckCircle2 size={16} />} tone="success" />
            <MetricCard title="Not checked in" value={currentReport.statistics.absent} icon={<CalendarDays size={16} />} tone="warning" />
            <MetricCard title="Attendance rate" value={`${currentReport.statistics.attendancePercentage.toFixed(1)}%`} icon={<CheckCircle2 size={16} />} tone="navy" />
          </div>
          <div className="attendance-breakdown"><span>Individual: <strong>{numberFormat.format(currentReport.statistics.individual.present)} / {numberFormat.format(currentReport.statistics.individual.total)}</strong> present</span><span>Team members: <strong>{numberFormat.format(currentReport.statistics.team.present)} / {numberFormat.format(currentReport.statistics.team.total)}</strong> present</span></div>
        </>}
        <AttendanceScanner enabled={selectedEvent?.status === "PUBLISHED"} onCheckedIn={() => { void loadAttendance(); }} />
        {exportError && <div className="attendance-export-error" role="alert">{exportError}</div>}
        <Card className="attendance-record-card">
          <div className="attendance-table-toolbar"><div><h2>Attendance records</h2><p>{currentReport ? `${numberFormat.format(currentReport.statistics.totalParticipants)} registered participants` : "Event participant check-in records"}</p></div><div className="attendance-filters"><label className="attendance-search"><Search size={14} /><input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Search participant or email" aria-label="Search attendance" /></label><select aria-label="Filter attendance status" value={params.attendance} onChange={event => updateFilter("attendance", event.target.value as AttendanceParams["attendance"])}><option value="ALL">All attendance</option><option value="PRESENT">Checked in</option><option value="ABSENT">Not checked in</option></select></div></div>
          {error ? <div className="attendance-state compact"><p>{error}</p><Button variant="secondary" onClick={() => void loadAttendance()}>Try again</Button></div>
            : loading ? <AttendanceTableSkeleton />
            : !currentReport?.participants.length ? <div className="attendance-state compact"><span className="attendance-state-icon"><Users size={18} /></span><h2>{params.search || params.attendance !== "ALL" ? "No matching registrations" : "No registered participants"}</h2><p>{params.search || params.attendance !== "ALL" ? "Change your search or attendance filter." : "Registered participants for this event will appear here."}</p></div>
            : <>
              <div className="attendance-table-wrap"><table className="attendance-table"><thead><tr><th>Participant</th><th>Registration ID</th><th>Team / type</th><th>Attendance</th><th>Checked in</th></tr></thead><tbody>{currentReport.participants.map(participant => <AttendanceRow key={participant.registrationId} participant={participant} />)}</tbody></table></div>
              <div className="attendance-pagination"><span>{numberFormat.format(currentReport.pagination.total)} records · Page {params.page} of {Math.max(1, currentReport.pagination.totalPages)}</span><div><label>Rows <select aria-label="Rows per page" value={params.limit} onChange={event => updateFilter("limit", Number(event.target.value))}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label><Button variant="secondary" icon={<ChevronLeft size={14} />} onClick={() => setParams(current => ({ ...current, page: Math.max(1, current.page - 1) }))} disabled={params.page <= 1 || loading}>Previous</Button><Button variant="secondary" onClick={() => setParams(current => ({ ...current, page: current.page + 1 }))} disabled={params.page >= currentReport.pagination.totalPages || loading}>Next <ChevronRight size={14} /></Button></div></div>
            </>}
        </Card>
      </> : !eventsLoading && <Card className="attendance-state"><span className="attendance-state-icon"><CalendarDays size={19} /></span><h2>No events available</h2><p>Create an event before tracking attendance.</p></Card>}
    </>}
  </>;
}

function MetricCard({ title, value, icon, tone }: { title: string; value: number | string; icon: React.ReactNode; tone: string }) { return <Card className="attendance-metric-card"><span className={`attendance-metric-icon tone-${tone}`}>{icon}</span><div><small>{title}</small><strong>{typeof value === "number" ? numberFormat.format(value) : value}</strong></div></Card>; }
function AttendanceRow({ participant }: { participant: AttendanceParticipant }) { return <tr><td><div className="attendance-person"><strong>{participant.name || "Participant"}</strong><small>{participant.email || "Email unavailable"}</small></div></td><td><code title={participant.registrationId}>{participant.registrationId}</code></td><td><span className={`attendance-type ${participant.registrationType.toLowerCase()}`}>{participant.registrationType === "TEAM" ? "Team" : "Individual"}</span>{participant.teamName && <small className="attendance-team-name">{participant.teamName}{participant.isTeamLeader ? " · Leader" : ""}</small>}</td><td><span className={`attendance-status ${participant.attendance.toLowerCase()}`}>{participant.attendance === "PRESENT" ? "Checked in" : "Not checked in"}</span></td><td>{participant.checkedInAt ? formatDateTime(participant.checkedInAt) : "—"}</td></tr>; }
function MetricCardSkeleton() { return <div className="attendance-metric-skeleton"><span /><span /></div>; }
function AttendanceMetricsSkeleton() { return <div className="attendance-metric-grid">{[0, 1, 2, 3].map(item => <Card key={item} className="attendance-metric-card"><MetricCardSkeleton /></Card>)}</div>; }
function AttendanceTableSkeleton() { return <div className="attendance-table-skeleton" aria-label="Loading attendance">{[0, 1, 2, 3, 4].map(item => <span key={item} />)}</div>; }
function titleCase(value: string) { return value.toLowerCase().replace(/\b\w/g, char => char.toUpperCase()); }
function formatDate(value?: string) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date); }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : dateTimeFormat.format(date); }
