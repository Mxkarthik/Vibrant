import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { getMyRegistrations, type MyRegistration } from "../api/registrationService";

type AttendanceRecord = MyRegistration & { event: NonNullable<MyRegistration["event"]> };

export default function MyAttendancePage() {
  const [records, setRecords] = useState<MyRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getMyRegistrations(controller.signal)
      .then(setRecords)
      .catch((requestError: unknown) => {
        if (axios.isCancel(requestError)) return;
        const status = axios.isAxiosError(requestError) ? requestError.response?.status : undefined;
        setError(status === 401
          ? "Your session has expired. Sign in again to view your attendance."
          : status === 403
            ? "This account cannot access participant attendance."
            : "Attendance information could not be loaded. Check your connection and try again.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reloadKey]);

  const attendanceRecords = useMemo(() => records.filter((record): record is AttendanceRecord => Boolean(record.event)), [records]);
  const attended = attendanceRecords.filter((record) => record.attendance?.isPresent === true);
  const upcoming = attendanceRecords.filter((record) => isUpcoming(record));

  return <div className="my-attendance-page">
    <header className="my-attendance-heading">
      <div><p className="participant-eyebrow">YOUR EVENT PARTICIPATION</p><h1>My attendance</h1><p>Check-in history for events you registered for.</p></div>
      <button className="participant-refresh-button" type="button" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>{loading ? "Loading…" : "Refresh"}<span aria-hidden="true">↻</span></button>
    </header>

    {error && <section className="attendance-state is-error" role="alert"><span className="discover-state-mark">!</span><h2>Couldn’t load attendance</h2><p>{error}</p><div><button className="participant-button" type="button" onClick={() => setReloadKey((value) => value + 1)}>Try again</button>{error.includes("Sign in") && <Link to="/login">Sign in</Link>}</div></section>}

    {loading && <div className="attendance-list" aria-label="Loading attendance">{[0, 1, 2].map((item) => <div className="attendance-skeleton" key={item}><span /><div><i /><i /></div></div>)}</div>}

    {!loading && !error && <>
      <section className="attendance-summary" aria-label="Attendance summary">
        <article><span>Events attended</span><strong>{attended.length}</strong></article>
        <article><span>Upcoming registered events</span><strong>{upcoming.length}</strong></article>
      </section>
      {attendanceRecords.length === 0
        ? <section className="attendance-state"><span className="discover-state-mark">V</span><h2>No attendance records yet</h2><p>Once you register for events, their check-in status will appear here.</p><Link className="participant-button" to="/events">Explore Events</Link></section>
        : <section className="attendance-list" aria-label="Event attendance history">{attendanceRecords.map((record) => <AttendanceCard key={record.id} record={record} />)}</section>}
    </>}
  </div>;
}

function AttendanceCard({ record }: { record: AttendanceRecord }) {
  const event = record.event;
  const checkedIn = record.attendance?.isPresent === true;
  const cancelled = record.status === "CANCELLED" || event.status === "CANCELLED";
  const completed = event.status === "COMPLETED";
  const upcoming = isUpcoming(record);
  const label = cancelled ? "Event cancelled" : checkedIn ? "Attended" : upcoming ? "Not yet attended" : completed ? "Attendance not recorded" : "Attendance unavailable";
  const tone = cancelled ? "badge-neutral" : checkedIn ? "badge-success" : upcoming ? "badge-warning" : "badge-neutral";
  const detailPath = record.isTeam && record.isTeamLeader && record.teamId ? `/teams/${record.teamId}` : `/registrations/${record.id}`;

  return <article className="attendance-record">
    <div className="attendance-record-main">
      <div className="attendance-record-title"><span className="participant-category">{event.category || "EVENT"}</span><span className={`participant-status-badge ${tone}`}>{label}</span></div>
      <h2>{event.name}</h2>
      <p>{formatDate(event.startDate)}{event.endDate && event.endDate !== event.startDate ? ` – ${formatDate(event.endDate)}` : ""}{event.venue ? ` · ${event.venue}` : ""}</p>
      <div className="attendance-record-facts">
        <Fact label="Registration" value={record.id} />
        <Fact label="Type" value={record.isTeam ? `Team${record.team?.name ? ` · ${record.team.name}` : ""}` : "Individual"} />
        <Fact label="Check-in" value={checkedIn ? formatDateTime(record.attendance.checkedInAt) : "Not recorded"} />
      </div>
      <div className="attendance-record-links"><Link to={`/events/${event.id}`}>Event details <span aria-hidden="true">↗</span></Link><Link to={detailPath}>{record.isTeam ? "Team details" : "Registration details"} <span aria-hidden="true">↗</span></Link>{record.isTeam && record.isTeamLeader && record.teamId && <Link to={`/teams/${record.teamId}/tickets`}>Team tickets <span aria-hidden="true">↗</span></Link>}{record.certificate?.isIssued && record.certificate.certificateId && <Link to="/my-certificates">View certificate <span aria-hidden="true">↗</span></Link>}</div>
    </div>
  </article>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong title={value}>{value}</strong></div>; }
function isUpcoming(record: AttendanceRecord) {
  const end = new Date(record.event.endDate).getTime();
  return record.status === "REGISTERED" && record.event.status !== "CANCELLED" && record.event.status !== "COMPLETED" && Number.isFinite(end) && end >= Date.now();
}
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date); }
function formatDateTime(value: string | null) { if (!value) return "Checked in; time unavailable"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "Checked in; time unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date); }
