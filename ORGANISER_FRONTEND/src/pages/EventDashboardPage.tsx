import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw,
  Download,
  Calendar,
  MapPin,
  QrCode,
  ClipboardList,
  AlertCircle,
  ArrowLeft,
  Layers,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  BarChart2,
} from "lucide-react";
import { getEventById, getEvents, filterAccessibleEvents } from "../api/eventService";
import { getEventAttendance, exportEventAttendance } from "../api/attendanceService";
import { useAuth } from "../auth/AuthContext";
import EventSelector from "../components/events/EventSelector";
import { getApiErrorMessage } from "../api/client";
import { setActiveEventId } from "../utils/activeEventStorage";

export default function EventDashboardPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (eventId) {
      setActiveEventId(eventId);
    }
  }, [eventId]);

  // 1. Fetch current event details
  const {
    data: event,
    isLoading: eventLoading,
    isError: eventError,
    error: eventErr,
  } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => getEventById(eventId!),
    enabled: Boolean(eventId),
  });

  // 2. Fetch accessible events list for selector (scoped by user.id)
  const { data: rawEvents = [] } = useQuery({
    queryKey: ["events", user?.id],
    queryFn: getEvents,
    staleTime: 60000,
  });

  const accessibleEvents = filterAccessibleEvents(rawEvents, user);

  // 3. Fetch attendance statistics
  const {
    data: report,
    isLoading: attendanceLoading,
    isError: attendanceError,
    error: attendanceErr,
    refetch: refetchAttendance,
    isFetching: attendanceFetching,
  } = useQuery({
    queryKey: ["attendance", eventId],
    queryFn: () => getEventAttendance(eventId!),
    enabled: Boolean(eventId),
    staleTime: 15000,
  });

  const handleExport = async () => {
    if (!eventId || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      await exportEventAttendance(eventId, event?.name);
    } catch (err) {
      setExportError(getApiErrorMessage(err, "Failed to export attendance spreadsheet."));
    } finally {
      setExporting(false);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const loading = eventLoading || attendanceLoading;
  const isCombo = Boolean(event?.multiEventAccess?.enabled);

  if (!eventId) {
    return (
      <div className="dashboard-page-container container">
        {/* 1. Header Context */}
        <div className="dashboard-header-wrap">
          <div className="dashboard-header-top">
            <div className="dashboard-title-section">
              <h1 className="dashboard-page-title">Event Dashboard</h1>
              <p className="dashboard-page-subtitle">
                Real-time check-in metrics, attendee breakdowns and venue operational status.
              </p>
            </div>
          </div>

          {/* Event Context Bar with Event Switcher */}
          <div className="dashboard-context-bar">
            <div className="dashboard-context-left">
              <EventSelector
                events={accessibleEvents}
                selectedEventId=""
                onSelectEvent={(newId) => {
                  setActiveEventId(newId);
                  navigate(`/events/${newId}/dashboard`);
                }}
              />
            </div>
          </div>
        </div>

        {/* Informative No-Event Prompt Card */}
        <div className="dashboard-card" style={{ textAlign: "center", padding: "48px 24px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "50%",
              background: "var(--primary-light)",
              color: "var(--primary)",
              display: "grid",
              placeItems: "center",
              margin: "0 auto 16px",
            }}
          >
            <BarChart2 size={28} />
          </div>
          <h2 style={{ fontSize: "18px", fontWeight: 800, color: "var(--navy)", marginBottom: "8px" }}>
            Select an Event to View Dashboard
          </h2>
          <p style={{ fontSize: "13px", color: "var(--secondary)", maxWidth: "420px", margin: "0 auto", lineHeight: 1.5 }}>
            Choose an event venue from the dropdown above to view check-in statistics and operational metrics.
          </p>
        </div>
      </div>
    );
  }

  if (loading && !report) {
    return (
      <div className="dashboard-page-container container" style={{ textAlign: "center", padding: "60px 20px" }}>
        <RefreshCw size={28} className="is-spinning" style={{ color: "var(--blue)", margin: "0 auto 12px" }} />
        <p style={{ color: "var(--secondary)", fontSize: "14px" }}>Loading event dashboard…</p>
      </div>
    );
  }

  if (eventError || attendanceError) {
    const errorObj = eventErr || attendanceErr;
    return (
      <div className="dashboard-page-container container">
        <div
          style={{
            background: "var(--error-bg)",
            border: "1px solid #fca5a5",
            borderRadius: "var(--radius-md)",
            padding: "32px 24px",
            textAlign: "center",
            marginTop: "20px",
          }}
          role="alert"
        >
          <AlertCircle size={36} color="var(--error)" style={{ margin: "0 auto 12px" }} />
          <h2 style={{ fontSize: "18px", color: "var(--error)", marginBottom: "8px" }}>
            Unable to Load Event Dashboard
          </h2>
          <p style={{ fontSize: "13px", color: "var(--secondary)", marginBottom: "20px" }}>
            {getApiErrorMessage(errorObj, "Failed to retrieve attendance records. You may not be assigned to this event.")}
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate("/events")}
            >
              <ArrowLeft size={14} />
              <span>Back to Events</span>
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void refetchAttendance()}
            >
              <RefreshCw size={14} />
              <span>Retry</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Check for malformed response: statistics object missing or incomplete
  const isMalformedReport = report && (!report.statistics || typeof report.statistics.totalParticipants !== "number");
  if (isMalformedReport) {
    return (
      <div className="dashboard-page-container container">
        <div
          style={{
            background: "var(--error-bg)",
            border: "1px solid #fca5a5",
            borderRadius: "var(--radius-md)",
            padding: "32px 24px",
            textAlign: "center",
            marginTop: "20px",
          }}
          role="alert"
        >
          <AlertCircle size={36} color="var(--error)" style={{ margin: "0 auto 12px" }} />
          <h2 style={{ fontSize: "18px", color: "var(--error)", marginBottom: "8px" }}>
            Malformed Attendance Data
          </h2>
          <p style={{ fontSize: "13px", color: "var(--secondary)", marginBottom: "20px" }}>
            The attendance statistics object returned by the server is missing required fields.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate("/events")}
          >
            <ArrowLeft size={14} />
            <span>Back to Events</span>
          </button>
        </div>
      </div>
    );
  }

  const rawStats = report?.statistics;
  // Map actual backend statistics with safe defensive fallbacks for alias fields
  const stats = {
    totalParticipants: rawStats?.totalParticipants ?? 0,
    present: rawStats?.present ?? rawStats?.presentParticipants ?? 0,
    absent: rawStats?.absent ?? rawStats?.pendingParticipants ?? 0,
    attendancePercentage: rawStats?.attendancePercentage ?? rawStats?.attendanceRate ?? 0,
    direct: rawStats?.direct ?? { total: 0, present: 0, absent: 0 },
    combo: rawStats?.combo ?? { total: 0, present: 0, absent: 0 },
    individual: rawStats?.individual ?? { total: 0, present: 0, absent: 0 },
    team: rawStats?.team ?? { total: 0, present: 0, absent: 0 },
    admissionEligible: rawStats?.admissionEligible,
  };

  const directPercent = stats.direct.total > 0 ? (stats.direct.present / stats.direct.total) * 100 : 0;
  const comboPercent = stats.combo.total > 0 ? (stats.combo.present / stats.combo.total) * 100 : 0;
  const individualPercent = stats.individual.total > 0 ? (stats.individual.present / stats.individual.total) * 100 : 0;
  const teamPercent = stats.team.total > 0 ? (stats.team.present / stats.team.total) * 100 : 0;
  const eligiblePercent =
    stats.admissionEligible && stats.admissionEligible.total > 0
      ? (stats.admissionEligible.present / stats.admissionEligible.total) * 100
      : 0;

  // SVG circular gauge calculation: circumference = 2 * PI * 42 ≈ 263.89
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const clampedAttendance = Math.min(100, Math.max(0, stats.attendancePercentage));
  const strokeDashoffset = circumference - (clampedAttendance / 100) * circumference;

  return (
    <div className="dashboard-page-container container">
      {/* 1. Dashboard Heading & Event Identity */}
      <div className="dashboard-header-wrap">
        <div className="dashboard-header-top">
          <div className="dashboard-title-section">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Link
                to="/events"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "12px",
                  color: "var(--blue)",
                  fontWeight: 600,
                }}
              >
                <ArrowLeft size={13} />
                <span>Events</span>
              </Link>
              <span style={{ color: "var(--border)" }}>•</span>
              <span style={{ fontSize: "12px", color: "var(--secondary)", fontWeight: 500 }}>
                Operations Dashboard
              </span>
            </div>
            <h1 className="dashboard-page-title">Dashboard</h1>
            <p className="dashboard-page-subtitle">
              Live attendance analytics and check-in performance for {event?.name}.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <Link
              to={`/events/${eventId}/attendance`}
              className="btn btn-secondary"
              style={{ padding: "8px 14px", fontSize: "13px" }}
            >
              <ClipboardList size={14} />
              <span>View Tracker</span>
            </Link>

            {!isCombo && (
              <Link
                to={`/events/${eventId}/scanner`}
                className="btn btn-primary"
                style={{ padding: "8px 14px", fontSize: "13px" }}
              >
                <QrCode size={14} />
                <span>Open Scanner</span>
              </Link>
            )}
          </div>
        </div>

        {/* 2. Event Context Bar with Event Switcher */}
        <div className="dashboard-context-bar">
          <div className="dashboard-context-left">
            <EventSelector
              events={accessibleEvents}
              selectedEventId={eventId || ""}
              onSelectEvent={(newId) => navigate(`/events/${newId}/dashboard`)}
            />

            <div style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: "12px", color: "var(--secondary)" }}>
              {event?.venue && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <MapPin size={13} color="var(--primary)" />
                  <span>{event.venue}</span>
                </span>
              )}

              {event?.startDate && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <Calendar size={13} color="var(--primary)" />
                  <span>{formatDate(event.startDate)}</span>
                </span>
              )}

              {isCombo && (
                <span
                  className="badge badge-combo"
                  title="Multi-Event Package Parent — Attendance is recorded at included child venues"
                >
                  <Layers size={10} style={{ marginRight: "3px" }} />
                  Multi-Event Package
                </span>
              )}
            </div>
          </div>

          <div className="dashboard-context-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void refetchAttendance()}
              disabled={attendanceFetching}
              title="Refresh attendance statistics"
              style={{ padding: "6px 12px", fontSize: "12px" }}
            >
              <RefreshCw size={13} className={attendanceFetching ? "is-spinning" : ""} />
              <span>{attendanceFetching ? "Refreshing…" : "Refresh"}</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleExport()}
              disabled={exporting || stats.totalParticipants === 0}
              title="Download Attendance Excel Spreadsheet"
              style={{ padding: "6px 12px", fontSize: "12px" }}
            >
              <Download size={13} />
              <span>{exporting ? "Generating…" : "Export Excel"}</span>
            </button>
          </div>
        </div>

        {exportError && (
          <div
            style={{
              marginBottom: "16px",
              padding: "10px 14px",
              background: "var(--error-bg)",
              border: "1px solid #fca5a5",
              borderRadius: "var(--radius-sm)",
              color: "var(--error)",
              fontSize: "12px",
            }}
            role="alert"
          >
            {exportError}
          </div>
        )}
      </div>

      {/* 3. Four KPI Metric Cards */}
      <div className="dashboard-kpi-grid metric-grid">
        {/* Card A: Registered */}
        <div className="dashboard-kpi-card metric-card">
          <span className="dashboard-kpi-val dashboard-kpi-val-navy">{stats.totalParticipants}</span>
          <span className="dashboard-kpi-label">Registered</span>
          <span className="dashboard-kpi-desc">
            Direct: {stats.direct.total} · Combo: {stats.combo.total}
          </span>
        </div>

        {/* Card B: Checked In */}
        <div className="dashboard-kpi-card metric-card">
          <span className="dashboard-kpi-val dashboard-kpi-val-green">{stats.present}</span>
          <span className="dashboard-kpi-label">Checked In</span>
          <span className="dashboard-kpi-desc">
            Direct: {stats.direct.present} · Combo: {stats.combo.present}
          </span>
        </div>

        {/* Card C: Absent / Pending Check-in */}
        <div className="dashboard-kpi-card metric-card">
          <span className="dashboard-kpi-val dashboard-kpi-val-amber">{stats.absent}</span>
          <span className="dashboard-kpi-label">Pending Check-in</span>
          <span className="dashboard-kpi-desc">Awaiting venue admission</span>
        </div>

        {/* Card D: Attendance Rate */}
        <div className="dashboard-kpi-card metric-card">
          <span className="dashboard-kpi-val dashboard-kpi-val-indigo">
            {stats.attendancePercentage.toFixed(1)}%
          </span>
          <span className="dashboard-kpi-label">Attendance Rate</span>
          <span className="dashboard-kpi-desc">Of verified eligible participants</span>
        </div>
      </div>

      {/* 4. Attendance Progress Visualization */}
      <div className="dashboard-progress-card">
        <div className="dashboard-progress-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Sparkles size={16} color="var(--primary)" />
            <h2 className="dashboard-progress-title">Live Venue Attendance Performance</h2>
          </div>
          <span
            className="badge"
            style={{
              background: "var(--success-bg)",
              color: "var(--success)",
              border: "1px solid var(--success-border)",
            }}
          >
            ● Live Check-in Active
          </span>
        </div>

        <div className="dashboard-progress-content">
          {/* Circular Progress Gauge */}
          <div className="dashboard-gauge-container">
            <svg className="dashboard-gauge-svg" viewBox="0 0 100 100" aria-hidden="true">
              <circle
                className="dashboard-gauge-bg"
                cx="50"
                cy="50"
                r={radius}
                strokeWidth="8"
              />
              <circle
                className="dashboard-gauge-fill"
                cx="50"
                cy="50"
                r={radius}
                strokeWidth="8"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
              />
            </svg>
            <div className="dashboard-gauge-center">
              <span className="dashboard-gauge-number">{Math.round(clampedAttendance)}%</span>
              <span className="dashboard-gauge-label">Attended</span>
            </div>
          </div>

          {/* Progress Details & Linear Progress Track */}
          <div className="dashboard-progress-details">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
              <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--navy)" }}>
                {stats.present} of {stats.totalParticipants} Participants Checked In
              </span>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--primary)" }}>
                {stats.attendancePercentage.toFixed(1)}%
              </span>
            </div>

            <div
              role="progressbar"
              aria-valuenow={Math.round(clampedAttendance)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Venue attendance percentage"
              className="dashboard-progress-track"
            >
              <div
                className="dashboard-progress-fill"
                style={{ width: `${clampedAttendance}%` }}
              />
            </div>

            <span style={{ fontSize: "12px", color: "var(--secondary)" }}>
              {stats.totalParticipants === 0
                ? "No registrations recorded for this event yet."
                : `${stats.absent} participants have yet to be checked in at this event venue.`}
            </span>
          </div>
        </div>
      </div>

      {/* 5. Direct vs Combo Cohort Breakdown */}
      <div className="dashboard-breakdown-card">
        <div className="dashboard-breakdown-header">
          <h2 className="dashboard-breakdown-title">Registration Cohort Breakdown</h2>
          <span style={{ fontSize: "12px", color: "var(--secondary)" }}>
            Unified Direct & Multi-Event Entitlements
          </span>
        </div>

        {stats.totalParticipants === 0 ? (
          <div style={{ textAlign: "center", padding: "24px", color: "var(--secondary)", fontSize: "13px" }}>
            No eligible participant cohorts recorded for this event yet.
          </div>
        ) : (
          <div className="dashboard-breakdown-list">
            {/* Direct Registrations */}
            <div className="dashboard-breakdown-row">
              <div className="dashboard-breakdown-label-row">
                <span className="dashboard-breakdown-name">
                  <CheckCircle2 size={13} color="var(--success)" />
                  <span>Direct Registrations</span>
                </span>
                <span className="dashboard-breakdown-stat">
                  {stats.direct.present} / {stats.direct.total} ({directPercent.toFixed(1)}%)
                </span>
              </div>
              <div className="dashboard-progress-track">
                <div
                  className="dashboard-progress-fill"
                  style={{
                    width: `${Math.min(100, Math.max(0, directPercent))}%`,
                    background: "var(--success)",
                  }}
                />
              </div>
            </div>

            {/* Combo-Entitled Passes */}
            <div className="dashboard-breakdown-row">
              <div className="dashboard-breakdown-label-row">
                <span className="dashboard-breakdown-name">
                  <Layers size={13} color="var(--primary)" />
                  <span>Combo Pass Attendees</span>
                </span>
                <span className="dashboard-breakdown-stat">
                  {stats.combo.present} / {stats.combo.total} ({comboPercent.toFixed(1)}%)
                </span>
              </div>
              <div className="dashboard-progress-track">
                <div
                  className="dashboard-progress-fill"
                  style={{
                    width: `${Math.min(100, Math.max(0, comboPercent))}%`,
                    background: "var(--primary)",
                  }}
                />
              </div>
            </div>

            {/* Individual vs Team Breakdown Sub-Grid */}
            <div className="dashboard-sub-breakdown-grid">
              <div className="dashboard-breakdown-row">
                <div className="dashboard-breakdown-label-row">
                  <span className="dashboard-breakdown-name" style={{ fontSize: "12px" }}>
                    Individual Registrations
                  </span>
                  <span className="dashboard-breakdown-stat">
                    {stats.individual.present} / {stats.individual.total} ({individualPercent.toFixed(1)}%)
                  </span>
                </div>
                <div className="dashboard-progress-track" style={{ height: "6px" }}>
                  <div
                    className="dashboard-progress-fill"
                    style={{ width: `${Math.min(100, Math.max(0, individualPercent))}%` }}
                  />
                </div>
              </div>

              <div className="dashboard-breakdown-row">
                <div className="dashboard-breakdown-label-row">
                  <span className="dashboard-breakdown-name" style={{ fontSize: "12px" }}>
                    Team Member Registrations
                  </span>
                  <span className="dashboard-breakdown-stat">
                    {stats.team.present} / {stats.team.total} ({teamPercent.toFixed(1)}%)
                  </span>
                </div>
                <div className="dashboard-progress-track" style={{ height: "6px" }}>
                  <div
                    className="dashboard-progress-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, teamPercent))}%`,
                      background: "var(--warning)",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Admission-Eligible (Verified Payment) Cohort */}
            {stats.admissionEligible && (
              <div
                className="dashboard-breakdown-row"
                style={{ marginTop: "6px", paddingTop: "12px", borderTop: "1px dashed var(--border-light)" }}
              >
                <div className="dashboard-breakdown-label-row">
                  <span className="dashboard-breakdown-name">
                    <ShieldCheck size={13} color="var(--success)" />
                    <span>Payment Verified / Admission-Eligible</span>
                  </span>
                  <span className="dashboard-breakdown-stat">
                    {stats.admissionEligible.present} / {stats.admissionEligible.total} ({eligiblePercent.toFixed(1)}%)
                  </span>
                </div>
                <div className="dashboard-progress-track">
                  <div
                    className="dashboard-progress-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, eligiblePercent))}%`,
                      background: "var(--success)",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 6. Quick Operations Actions */}
      <div className="dashboard-actions-grid">
        {/* Action 1: QR Check-in Scanner */}
        {isCombo ? (
          <div
            className="dashboard-action-card"
            style={{ opacity: 0.7, cursor: "not-allowed", background: "var(--bg-subtle)" }}
            title="Multi-Event Packages are registration packages, not physical venues. Attendance must be recorded at an included child event venue."
          >
            <div className="dashboard-action-icon" style={{ background: "var(--border-light)", color: "var(--secondary)" }}>
              <QrCode size={20} />
            </div>
            <div className="dashboard-action-info">
              <strong className="dashboard-action-title">Scanner Unavailable</strong>
              <small className="dashboard-action-desc">Select an included child event venue to scan</small>
            </div>
          </div>
        ) : (
          <Link
            to={`/events/${eventId}/scanner`}
            className="dashboard-action-card"
            title="Open Live QR & Manual Check-in Scanner"
          >
            <div className="dashboard-action-icon" style={{ background: "var(--primary-light)", color: "var(--primary)" }}>
              <QrCode size={20} />
            </div>
            <div className="dashboard-action-info">
              <strong className="dashboard-action-title">Open Scanner</strong>
              <small className="dashboard-action-desc">QR scanner & manual check-in</small>
            </div>
          </Link>
        )}

        {/* Action 2: Attendance Tracker */}
        <Link
          to={`/events/${eventId}/attendance`}
          className="dashboard-action-card"
          title="Open Participant Attendance Tracker & Roster"
        >
          <div className="dashboard-action-icon" style={{ background: "#fef3c7", color: "#b45309" }}>
            <ClipboardList size={20} />
          </div>
          <div className="dashboard-action-info">
            <strong className="dashboard-action-title">View Tracker</strong>
            <small className="dashboard-action-desc">Search, filter & participant roster</small>
          </div>
        </Link>

        {/* Action 3: Download Attendance Excel Spreadsheet */}
        <div
          className="dashboard-action-card"
          role="button"
          tabIndex={0}
          onClick={() => void handleExport()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void handleExport();
            }
          }}
          style={{ cursor: exporting || stats.totalParticipants === 0 ? "not-allowed" : "pointer" }}
          title="Download XLSX participant attendance report"
        >
          <div className="dashboard-action-icon" style={{ background: "var(--success-bg)", color: "var(--success)" }}>
            <Download size={20} />
          </div>
          <div className="dashboard-action-info">
            <strong className="dashboard-action-title">Export Excel</strong>
            <small className="dashboard-action-desc">
              {exporting ? "Generating spreadsheet…" : "Download participant report"}
            </small>
          </div>
        </div>
      </div>
    </div>
  );
}
