import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Search,
  RefreshCw,
  Download,
  QrCode,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  X,
  ClipboardList,
} from "lucide-react";
import { getEventById, getEvents, filterAccessibleEvents } from "../api/eventService.ts";
import {
  getEventAttendance,
  getEventParticipants,
  exportEventAttendance,
  type EventParticipantRegistration,
} from "../api/attendanceService.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import EventSelector from "../components/events/EventSelector.tsx";
import AttendanceTable from "../components/tracker/AttendanceTable.tsx";
import ParticipantDetails from "../components/tracker/ParticipantDetails.tsx";
import { getApiErrorMessage } from "../api/client.ts";
import { setActiveEventId } from "../utils/activeEventStorage.ts";

export default function AttendanceTrackerPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (eventId) {
      setActiveEventId(eventId);
    }
  }, [eventId]);

  // Search & Filter state
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [attendanceFilter, setAttendanceFilter] = useState<"PRESENT" | "ABSENT" | "">("");
  const [typeFilter, setTypeFilter] = useState<"INDIVIDUAL" | "TEAM" | "">("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<
    "VERIFIED" | "PENDING" | "NOT_REQUIRED" | "REJECTED" | ""
  >("");
  const [statusFilter, setStatusFilter] = useState<"REGISTERED" | "CANCELLED" | "ALL">("REGISTERED");
  const [page, setPage] = useState(1);
  const limit = 20;

  // Selected participant for read-only detail drawer
  const [selectedReg, setSelectedReg] = useState<EventParticipantRegistration | null>(null);

  // Export state
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // 300ms Search Debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1); // Reset to page 1 on search change
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

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

  // 2. Fetch accessible events list for switcher
  const { data: rawEvents = [] } = useQuery({
    queryKey: ["events", user?.id],
    queryFn: getEvents,
    staleTime: 60000,
  });

  const accessibleEvents = filterAccessibleEvents(rawEvents, user);

  // 3. Fetch summary metrics from attendance stats endpoint
  const {
    data: attendanceReport,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ["attendance", eventId],
    queryFn: () => getEventAttendance(eventId!),
    enabled: Boolean(eventId),
    staleTime: 15000,
  });

  // 4. Fetch paginated participants with server-side filters
  const {
    data: participantsData,
    isLoading: participantsLoading,
    isError: participantsError,
    error: participantsErr,
    refetch: refetchParticipants,
    isFetching: participantsFetching,
  } = useQuery({
    queryKey: [
      "participants",
      eventId,
      page,
      limit,
      debouncedSearch,
      attendanceFilter,
      typeFilter,
      paymentStatusFilter,
      statusFilter,
    ],
    queryFn: () =>
      getEventParticipants(eventId!, {
        page,
        limit,
        search: debouncedSearch,
        attendance: attendanceFilter,
        type: typeFilter,
        paymentStatus: paymentStatusFilter,
        status: statusFilter,
      }),
    enabled: Boolean(eventId),
    staleTime: 15000,
  });

  // Reset page when any filter changes
  const handleFilterChange = (setter: (val: any) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setter(e.target.value);
    setPage(1);
  };

  const handleClearFilters = () => {
    setSearchInput("");
    setDebouncedSearch("");
    setAttendanceFilter("");
    setTypeFilter("");
    setPaymentStatusFilter("");
    setStatusFilter("REGISTERED");
    setPage(1);
  };

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

  const refreshAll = () => {
    void refetchStats();
    void refetchParticipants();
  };

  if (!eventId) {
    return (
      <div className="tracker-page-container container">
        {/* 1. Header & Navigation Context */}
        <div className="tracker-header-wrap">
          <div className="tracker-header-top">
            <div className="tracker-title-section">
              <h1 className="tracker-page-title">Attendance Tracker</h1>
              <p className="tracker-page-subtitle">
                Unified live attendance tracker for both individual and combo participants.
              </p>
            </div>
          </div>

          {/* Event Context Bar with Event Switcher */}
          <div className="tracker-context-bar">
            <div className="tracker-context-left">
              <EventSelector
                events={accessibleEvents}
                selectedEventId=""
                onSelectEvent={(newId) => {
                  setActiveEventId(newId);
                  navigate(`/events/${newId}/attendance`);
                }}
              />
            </div>
          </div>
        </div>

        {/* Informative No-Event Prompt Card */}
        <div className="tracker-card" style={{ textAlign: "center", padding: "48px 24px" }}>
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
            <ClipboardList size={28} />
          </div>
          <h2 style={{ fontSize: "18px", fontWeight: 800, color: "var(--navy)", marginBottom: "8px" }}>
            Select an Event to View Attendance
          </h2>
          <p style={{ fontSize: "13px", color: "var(--secondary)", maxWidth: "420px", margin: "0 auto", lineHeight: 1.5 }}>
            Choose an event venue from the dropdown above to view participant roster and attendance metrics.
          </p>
        </div>
      </div>
    );
  }

  if (eventLoading && !event) {
    return (
      <div className="tracker-page-container container" style={{ textAlign: "center", padding: "60px 20px" }}>
        <RefreshCw size={28} className="is-spinning" style={{ color: "var(--blue)", margin: "0 auto 12px" }} />
        <p style={{ color: "var(--secondary)", fontSize: "14px" }}>Loading attendance tracker…</p>
      </div>
    );
  }

  if (eventError || !event) {
    return (
      <div className="tracker-page-container container">
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
            Unable to Load Attendance Tracker
          </h2>
          <p style={{ fontSize: "13px", color: "var(--secondary)", marginBottom: "20px" }}>
            {getApiErrorMessage(eventErr, "The event was not found or you lack permission.")}
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => navigate("/events")}>
            <ArrowLeft size={14} />
            <span>Back to Events</span>
          </button>
        </div>
      </div>
    );
  }

  const rawStats = attendanceReport?.statistics;
  const stats = {
    totalParticipants: rawStats?.totalParticipants ?? 0,
    present: rawStats?.present ?? rawStats?.presentParticipants ?? 0,
    absent: rawStats?.absent ?? rawStats?.pendingParticipants ?? 0,
    attendancePercentage: rawStats?.attendancePercentage ?? rawStats?.attendanceRate ?? 0,
  };

  const pagination = participantsData?.pagination || { total: 0, page: 1, limit: 20, totalPages: 1 };
  const registrations = participantsData?.registrations || [];

  const hasActiveFilters = Boolean(
    attendanceFilter || typeFilter || paymentStatusFilter || statusFilter !== "REGISTERED" || searchInput
  );

  return (
    <div className="tracker-page-container container">
      {/* 1. Header & Navigation Context */}
      <div className="tracker-header-wrap">
        <div className="tracker-header-top">
          <div className="tracker-title-section">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Link
                to={`/events/${eventId}/dashboard`}
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
                <span>Dashboard</span>
              </Link>
              <span style={{ color: "var(--border)" }}>•</span>
              <span style={{ fontSize: "12px", color: "var(--secondary)", fontWeight: 500 }}>
                Venue Check-in
              </span>
            </div>
            <h1 className="tracker-page-title">Attendance Tracker</h1>
            <p className="tracker-page-subtitle">
              Monitor participant check-ins and search registrations for {event.name}.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <Link
              to={`/events/${eventId}/scanner`}
              className="btn btn-primary"
              style={{ padding: "8px 14px", fontSize: "13px" }}
            >
              <QrCode size={14} />
              <span>Open Scanner</span>
            </Link>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleExport()}
              disabled={exporting || stats.totalParticipants === 0}
              title="Download Attendance Spreadsheet"
              style={{ padding: "8px 14px", fontSize: "13px" }}
            >
              <Download size={14} />
              <span>{exporting ? "Exporting…" : "Export Excel"}</span>
            </button>
          </div>
        </div>

        {/* Event Context Bar with Event Switcher */}
        <div className="tracker-context-bar">
          <div className="tracker-context-left">
            <EventSelector
              events={accessibleEvents}
              selectedEventId={eventId || ""}
              onSelectEvent={(newId) => navigate(`/events/${newId}/attendance`)}
            />
          </div>

          <div className="tracker-context-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={refreshAll}
              disabled={participantsFetching || statsLoading}
              title="Refresh attendance data"
              style={{ padding: "6px 12px", fontSize: "12px" }}
            >
              <RefreshCw size={13} className={participantsFetching || statsLoading ? "is-spinning" : ""} />
              <span>Refresh</span>
            </button>
          </div>
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

      {/* 2. Modern KPI Cards (3-4 Stats Grid matching Design Reference) */}
      <div className="tracker-kpi-grid metric-grid">
        {/* Card 1: Total Registered */}
        <div className="tracker-kpi-card metric-card">
          <span className="tracker-kpi-val tracker-kpi-val-navy">{stats.totalParticipants}</span>
          <span className="tracker-kpi-label">Registered</span>
          <span className="tracker-kpi-desc">Unified Direct + Combo</span>
        </div>

        {/* Card 2: Checked In (Present) */}
        <div className="tracker-kpi-card metric-card">
          <span className="tracker-kpi-val tracker-kpi-val-green">{stats.present}</span>
          <span className="tracker-kpi-label">Checked In</span>
          <span className="tracker-kpi-desc">Verified at venue</span>
        </div>

        {/* Card 3: Absent */}
        <div className="tracker-kpi-card metric-card">
          <span className="tracker-kpi-val tracker-kpi-val-amber">{stats.absent}</span>
          <span className="tracker-kpi-label">Absent</span>
          <span className="tracker-kpi-desc">Awaiting check-in</span>
        </div>

        {/* Card 4: Attendance Rate */}
        <div className="tracker-kpi-card metric-card">
          <span className="tracker-kpi-val tracker-kpi-val-indigo">
            {stats.attendancePercentage.toFixed(1)}%
          </span>
          <span className="tracker-kpi-label">Attendance</span>
          <span className="tracker-kpi-desc">Venue check-in rate</span>
        </div>
      </div>

      {/* 3. Search & Server-Side Filtering Toolbar */}
      <div className="tracker-controls-card tracker-toolbar-card">
        {/* Modern Rounded Search Input with Clear Button */}
        <div className="tracker-search-wrap search-box">
          <Search size={16} className="tracker-search-icon search-box-icon" />
          <input
            type="text"
            className="tracker-search-input search-input"
            placeholder="Search by participant name, roll number, college, mobile…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search participants"
          />
          {searchInput && (
            <button
              type="button"
              className="tracker-search-clear"
              onClick={() => setSearchInput("")}
              aria-label="Clear search text"
              title="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Responsive Server Filters Row */}
        <div className="tracker-filters-row tracker-filters-grid">
          {/* Filter: Attendance */}
          <div className="filter-select-wrapper">
            <select
              className="tracker-filter-select form-select"
              value={attendanceFilter}
              onChange={handleFilterChange(setAttendanceFilter)}
              aria-label="Filter by attendance status"
            >
              <option value="">All Attendance</option>
              <option value="PRESENT">Present Only</option>
              <option value="ABSENT">Absent Only</option>
            </select>
          </div>

          {/* Filter: Type */}
          <div className="filter-select-wrapper">
            <select
              className="tracker-filter-select form-select"
              value={typeFilter}
              onChange={handleFilterChange(setTypeFilter)}
              aria-label="Filter by registration type"
            >
              <option value="">All Types</option>
              <option value="INDIVIDUAL">Individual</option>
              <option value="TEAM">Team Members</option>
            </select>
          </div>

          {/* Filter: Payment */}
          <div className="filter-select-wrapper">
            <select
              className="tracker-filter-select form-select"
              value={paymentStatusFilter}
              onChange={handleFilterChange(setPaymentStatusFilter)}
              aria-label="Filter by payment status"
            >
              <option value="">All Payment</option>
              <option value="VERIFIED">Verified</option>
              <option value="PENDING">Pending</option>
              <option value="NOT_REQUIRED">Not Required</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>

          {/* Filter: Registration Status */}
          <div className="filter-select-wrapper">
            <select
              className="tracker-filter-select form-select"
              value={statusFilter}
              onChange={handleFilterChange(setStatusFilter)}
              aria-label="Filter by registration status"
            >
              <option value="REGISTERED">Active Registered</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="ALL">All Statuses</option>
            </select>
          </div>
        </div>

        {/* Filter Summary & Instant Reset Bar */}
        <div className="tracker-summary-bar tracker-summary-row">
          <span>
            Showing {registrations.length} of {pagination.total} participants
            {debouncedSearch ? ` matching "${debouncedSearch}"` : ""}
          </span>

          {hasActiveFilters && (
            <button
              type="button"
              className="tracker-clear-btn btn-link"
              onClick={handleClearFilters}
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* 4. Participants Content Table / Loading / Empty */}
      {participantsLoading ? (
        <div
          style={{
            textAlign: "center",
            padding: "48px 20px",
            background: "var(--white)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
          }}
        >
          <RefreshCw size={24} className="is-spinning" style={{ color: "var(--blue)", margin: "0 auto 12px" }} />
          <p style={{ color: "var(--secondary)", fontSize: "13px" }}>Loading participant records…</p>
        </div>
      ) : participantsError ? (
        <div
          style={{
            padding: "32px 20px",
            background: "var(--error-bg)",
            border: "1px solid #fca5a5",
            borderRadius: "var(--radius-md)",
            textAlign: "center",
          }}
          role="alert"
        >
          <AlertCircle size={32} color="var(--error)" style={{ margin: "0 auto 8px" }} />
          <h3 style={{ fontSize: "16px", color: "var(--error)", marginBottom: "4px" }}>
            Failed to Load Participants
          </h3>
          <p style={{ fontSize: "13px", color: "var(--secondary)", marginBottom: "16px" }}>
            {getApiErrorMessage(participantsErr, "Could not fetch participants. You may not be assigned to this event.")}
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => void refetchParticipants()}>
            <RefreshCw size={14} />
            <span>Retry</span>
          </button>
        </div>
      ) : registrations.length === 0 ? (
        <div
          style={{
            padding: "48px 20px",
            background: "var(--white)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            textAlign: "center",
          }}
        >
          <Users size={40} style={{ color: "var(--muted)", margin: "0 auto 10px" }} />
          <h3 style={{ fontSize: "16px", color: "var(--navy)", marginBottom: "4px" }}>
            No Participants Found
          </h3>
          <p style={{ fontSize: "13px", color: "var(--secondary)", maxWidth: "400px", margin: "0 auto" }}>
            {debouncedSearch || attendanceFilter || typeFilter || paymentStatusFilter
              ? "No participants match the selected filter criteria. Try clearing search filters."
              : "No registrations have been recorded for this event yet."}
          </p>
        </div>
      ) : (
        <div className="tracker-table-card">
          <AttendanceTable
            registrations={registrations}
            onSelectRegistration={(reg) => setSelectedReg(reg)}
            targetEventName={event.name}
          />

          {/* Pagination Controls */}
          {pagination.totalPages > 1 && (
            <div className="pagination-bar">
              <span className="pagination-info">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
              </span>

              <div className="pagination-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  aria-label="Previous Page"
                  style={{ padding: "6px 12px", fontSize: "12px" }}
                >
                  <ChevronLeft size={14} />
                  <span>Previous</span>
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={page >= pagination.totalPages}
                  aria-label="Next Page"
                  style={{ padding: "6px 12px", fontSize: "12px" }}
                >
                  <span>Next</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. Read-Only Participant Details Drawer / Modal */}
      {selectedReg && (
        <ParticipantDetails
          registration={selectedReg}
          onClose={() => setSelectedReg(null)}
          targetEventName={event.name}
        />
      )}
    </div>
  );
}
