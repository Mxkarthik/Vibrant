import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Layers,
  AlertCircle,
  RefreshCw,
  QrCode,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";
import { getEventById, getEvents, filterAccessibleEvents } from "../api/eventService.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import EventScanner from "../components/scanner/EventScanner.tsx";
import { getApiErrorMessage } from "../api/client.ts";
import {
  setActiveEventId,
  clearActiveEventId,
  validateAndGetActiveEventId,
} from "../utils/activeEventStorage.ts";

export default function ScannerPage() {
  const { id: eventId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  // 1. Fetch accessible events list for context selector
  const { data: rawEvents = [], isLoading: eventsLoading } = useQuery({
    queryKey: ["events", user?.id],
    queryFn: getEvents,
    staleTime: 60000,
  });

  const accessibleEvents = filterAccessibleEvents(rawEvents, user);

  // 2. Fetch current event details if eventId is set in URL
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

  // Authoritative check based on actual backend metadata: multiEventAccess.enabled === true
  const isComboParent = Boolean(event?.multiEventAccess?.enabled);

  // Sync active event ID to storage ONLY if it is an individual physical event (never a package)
  useEffect(() => {
    if (eventId) {
      if (isComboParent) {
        clearActiveEventId();
      } else {
        setActiveEventId(eventId);
      }
    }
  }, [eventId, isComboParent]);

  // If at root /scanner without an eventId, validate stored active event against accessible list
  // Rules: must exist in accessible list AND must not be a combo package parent
  useEffect(() => {
    if (!eventId && accessibleEvents.length > 0) {
      const validStoredId = validateAndGetActiveEventId(accessibleEvents);
      if (validStoredId) {
        navigate(`/events/${validStoredId}/scanner`, { replace: true });
      }
    }
  }, [eventId, accessibleEvents, navigate]);

  // Loading state when fetching an explicitly requested event
  if (eventId && eventLoading) {
    return (
      <div className="container" style={{ textAlign: "center", padding: "60px 20px" }}>
        <RefreshCw size={28} className="is-spinning" style={{ color: "var(--primary)", margin: "0 auto 12px" }} />
        <p style={{ color: "var(--secondary)", fontSize: "14px" }}>Loading scanner environment…</p>
      </div>
    );
  }

  // Error state when an invalid or inaccessible eventId is in URL
  if (eventId && (eventError || !event)) {
    return (
      <div className="container">
        <div
          style={{
            background: "var(--error-bg)",
            border: "1px solid var(--error-border)",
            borderRadius: "var(--radius-md)",
            padding: "32px 24px",
            textAlign: "center",
            marginTop: "20px",
          }}
          role="alert"
        >
          <AlertCircle size={36} color="var(--error)" style={{ margin: "0 auto 12px" }} />
          <h2 style={{ fontSize: "18px", color: "var(--error)", marginBottom: "8px" }}>
            Unable to Load Scanner
          </h2>
          <p style={{ fontSize: "13px", color: "var(--secondary)", marginBottom: "20px" }}>
            {getApiErrorMessage(eventErr, "The requested event could not be found or you lack permission.")}
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

  // Elegant event selection landing state when navigating directly to /scanner without an active event
  if (!eventId || !event) {
    return (
      <div className="container">
        {/* Scanner-first Header Banner */}
        <div className="scanner-header-card">
          <div className="scanner-title-row">
            <div className="scanner-icon-box">
              <QrCode size={22} />
            </div>
            <div className="scanner-title-text">
              <h1>Event Check-in</h1>
              <p>Scan participant QR or use manual check-in.</p>
            </div>
          </div>

          <div className="scanner-event-selector-box">
            <label htmlFor="landing-event-select" className="scanner-event-selector-label">
              Select Event
            </label>
            <select
              id="landing-event-select"
              className="search-input"
              style={{ padding: "10px 14px", height: "auto", cursor: "pointer" }}
              disabled={eventsLoading || accessibleEvents.length === 0}
              value=""
              onChange={(e) => {
                const targetId = e.target.value;
                if (targetId) {
                  const targetEvent = accessibleEvents.find((evt) => evt._id === targetId);
                  if (targetEvent && !targetEvent.multiEventAccess?.enabled) {
                    setActiveEventId(targetId);
                  } else {
                    clearActiveEventId();
                  }
                  navigate(`/events/${targetId}/scanner`);
                }
              }}
            >
              <option value="" disabled>
                {eventsLoading
                  ? "Loading events…"
                  : accessibleEvents.length === 0
                  ? "No accessible events found"
                  : "Choose an event to activate scanner…"}
              </option>
              {accessibleEvents.map((evt) => {
                const isPkg = Boolean(evt.multiEventAccess?.enabled);
                return (
                  <option key={evt._id} value={evt._id}>
                    {isPkg ? `[Package] ${evt.name} — Not a Scanning Venue` : evt.name}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {/* Informative Prompt Card */}
        <div className="scanner-card" style={{ textAlign: "center", padding: "40px 24px" }}>
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
            <QrCode size={28} />
          </div>
          <h2 style={{ fontSize: "18px", fontWeight: 800, color: "var(--navy)", marginBottom: "8px" }}>
            Ready to Begin Check-in
          </h2>
          <p style={{ fontSize: "13px", color: "var(--secondary)", maxWidth: "420px", margin: "0 auto 24px", lineHeight: 1.5 }}>
            Select an event venue from the dropdown above or choose from your accessible events below to open the QR camera scanner.
          </p>

          {accessibleEvents.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxWidth: "420px", margin: "0 auto", textAlign: "left" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Select Event Venue:
              </span>
              {accessibleEvents.map((evt) => {
                const isPkg = Boolean(evt.multiEventAccess?.enabled);
                return (
                  <button
                    key={evt._id}
                    type="button"
                    className="btn btn-secondary"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 16px",
                      borderRadius: "var(--radius-sm)",
                      textAlign: "left",
                      border: isPkg ? "1px dashed var(--border)" : "1px solid var(--border)",
                      opacity: isPkg ? 0.8 : 1,
                    }}
                    onClick={() => {
                      if (!isPkg) {
                        setActiveEventId(evt._id);
                      } else {
                        clearActiveEventId();
                      }
                      navigate(`/events/${evt._id}/scanner`);
                    }}
                  >
                    <div>
                      <strong style={{ display: "block", fontSize: "13px", color: "var(--navy)" }}>
                        {evt.name}
                      </strong>
                      <span style={{ fontSize: "11px", color: "var(--secondary)" }}>
                        {isPkg ? "Multi-Event Package (Not a venue)" : evt.venue}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: "12px",
                        color: isPkg ? "var(--secondary)" : "var(--primary)",
                        fontWeight: 700,
                      }}
                    >
                      {isPkg ? "View Notice &rarr;" : "Select Venue &rarr;"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Active Scanner View with Selected Event
  return (
    <div className="container">
      {/* 1. Universal Event Header Card */}
      <div className="scanner-header-card">
        <div className="scanner-title-row">
          <div className="scanner-icon-box">
            <QrCode size={22} />
          </div>
          <div className="scanner-title-text">
            <h1>Event Check-in</h1>
            <p>Scan participant QR or use manual check-in.</p>
          </div>
        </div>

        <div className="scanner-event-selector-box">
          <label htmlFor="active-event-select" className="scanner-event-selector-label">
            Select Event
          </label>
          <select
            id="active-event-select"
            className="search-input"
            style={{ padding: "10px 14px", height: "auto", cursor: "pointer", fontWeight: 600 }}
            value={eventId}
            onChange={(e) => {
              const targetId = e.target.value;
              if (targetId && targetId !== eventId) {
                const targetEvent = accessibleEvents.find((evt) => evt._id === targetId);
                if (targetEvent && !targetEvent.multiEventAccess?.enabled) {
                  setActiveEventId(targetId);
                } else {
                  clearActiveEventId();
                }
                navigate(`/events/${targetId}/scanner`);
              }
            }}
          >
            {accessibleEvents.map((evt) => {
              const isPkg = Boolean(evt.multiEventAccess?.enabled);
              return (
                <option key={evt._id} value={evt._id}>
                  {isPkg ? `[Package] ${evt.name} — Not a Scanning Venue` : evt.name}
                </option>
              );
            })}
          </select>
        </div>

        {/* Active Venue Status Pill */}
        {isComboParent ? (
          <div
            className="scanner-venue-pill"
            style={{
              background: "#FAF5FF",
              borderColor: "#D8B4FE",
              color: "#7E22CE",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Layers size={14} color="#7E22CE" />
              <span>Multi-Event Package: {event.name}</span>
            </div>
            <span
              style={{
                background: "#7E22CE",
                color: "#FFFFFF",
                padding: "2px 8px",
                borderRadius: "9999px",
                fontSize: "10px",
                marginLeft: "6px",
                fontWeight: 700,
              }}
            >
              Select Venue Below
            </span>
          </div>
        ) : (
          <div className="scanner-venue-pill">
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <CheckCircle2 size={14} color="var(--success)" />
              <span>Active Venue: {event.name}</span>
            </div>
            <span className="scanner-venue-pill-ready">Ready</span>
          </div>
        )}
      </div>

      {/* 2. Combo Package Safeguard Banner: When a parent combo package is selected */}
      {isComboParent ? (
        <div
          className="scanner-card"
          style={{
            textAlign: "center",
            padding: "36px 24px",
            border: "1px solid #D8B4FE",
            background: "#FAF5FF",
            marginBottom: "20px",
          }}
        >
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "50%",
              background: "#F3E8FF",
              color: "#7E22CE",
              display: "grid",
              placeItems: "center",
              margin: "0 auto 16px",
            }}
          >
            <Layers size={28} />
          </div>

          <h2 style={{ fontSize: "18px", fontWeight: 800, color: "#581C87", marginBottom: "8px" }}>
            Multi-Event Package Selected
          </h2>

          <p
            style={{
              fontSize: "13px",
              color: "#6B21A8",
              maxWidth: "460px",
              margin: "0 auto 14px",
              lineHeight: 1.5,
            }}
          >
            <strong>"{event.name}"</strong> is a multi-event registration package rather than a physical attendance venue.
            Attendance must be recorded at a specific event venue where the attendee is present.
          </p>

          <p
            style={{
              fontSize: "13px",
              color: "var(--secondary)",
              maxWidth: "440px",
              margin: "0 auto 20px",
              lineHeight: 1.5,
            }}
          >
            Please choose the actual physical event from the <strong>Select Event</strong> dropdown above to activate the camera and start scanning.
          </p>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              background: "var(--white)",
              padding: "8px 16px",
              borderRadius: "var(--radius-pill)",
              border: "1px solid #D8B4FE",
              fontSize: "12px",
              color: "#7E22CE",
              fontWeight: 600,
            }}
          >
            <ShieldAlert size={15} color="#7E22CE" />
            <span>QR Scanner & Check-in are Disabled for Packages</span>
          </div>
        </div>
      ) : (
        /* 3. Operational QR Scanner Component for Physical Events */
        <EventScanner
          selectedEventId={eventId}
          selectedEventName={event.name}
          isComboParent={false}
        />
      )}
    </div>
  );
}
