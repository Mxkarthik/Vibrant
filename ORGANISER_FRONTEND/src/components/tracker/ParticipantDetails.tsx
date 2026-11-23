import { useEffect, useRef } from "react";
import {
  X,
  User,
  Mail,
  Phone,
  Building,
  GraduationCap,
  Users,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Calendar,
  Hash,
  MapPin,
  Layers,
} from "lucide-react";
import type { EventParticipantRegistration } from "../../api/attendanceService.ts";

interface ParticipantDetailsProps {
  registration: EventParticipantRegistration | null;
  onClose: () => void;
  targetEventName?: string;
}

export default function ParticipantDetails({
  registration,
  onClose,
  targetEventName,
}: ParticipantDetailsProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Focus management: save previous active element and restore on unmount
    const previousActiveElement = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousActiveElement?.focus?.();
    };
  }, [onClose]);

  if (!registration) return null;

  const {
    _id,
    participantDetails,
    user,
    team,
    isTeamLeader,
    payment,
    status,
    attendance,
    cohortType,
    parentEvent,
    createdAt,
  } = registration;

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "N/A";
    try {
      return new Date(dateStr).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  const getInitials = (name?: string) => {
    if (!name || !name.trim()) return "P";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const paymentStatus = team ? team.payment?.status || "NOT_REQUIRED" : payment?.status || "NOT_REQUIRED";
  const fullName = participantDetails?.fullName || user?.name || "Participant";
  const initials = getInitials(fullName);

  return (
    <div
      className="modal-backdrop tracker-modal-overlay"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="participant-details-title"
    >
      <div
        className="modal-content tracker-modal-box"
        style={{
          background: "var(--white)",
          borderRadius: "var(--radius-lg)",
          maxWidth: "540px",
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "24px",
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--border)",
        }}
      >
        {/* Modal Header */}
        <div
          className="tracker-modal-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "18px",
            borderBottom: "1px solid var(--border-light)",
            paddingBottom: "14px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              className="tracker-avatar-circle"
              style={{ width: "44px", height: "44px", fontSize: "16px" }}
              aria-hidden="true"
            >
              {initials}
            </div>

            <div>
              <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "4px", flexWrap: "wrap" }}>
                <span
                  className="badge"
                  style={{
                    background: attendance.isPresent ? "var(--success-bg)" : "var(--warning-bg)",
                    color: attendance.isPresent ? "var(--success)" : "#b45309",
                    border: `1px solid ${attendance.isPresent ? "var(--success-border)" : "var(--warning-border)"}`,
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "3px",
                  }}
                >
                  {attendance.isPresent ? (
                    <>
                      <CheckCircle2 size={11} />
                      <span>PRESENT</span>
                    </>
                  ) : (
                    <>
                      <Clock size={11} />
                      <span>ABSENT</span>
                    </>
                  )}
                </span>

                <span
                  className="badge"
                  style={{
                    background: cohortType === "COMBO" ? "#f3e8ff" : "var(--blue-light)",
                    color: cohortType === "COMBO" ? "#7e22ce" : "var(--blue)",
                    border: `1px solid ${cohortType === "COMBO" ? "#e9d5ff" : "var(--border)"}`,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "3px",
                  }}
                >
                  {cohortType === "COMBO" ? (
                    <>
                      <Layers size={11} />
                      <span>Combo Pass</span>
                    </>
                  ) : (
                    <span>Direct Registration</span>
                  )}
                </span>
              </div>

              <h2
                id="participant-details-title"
                style={{ fontSize: "20px", fontWeight: 800, color: "var(--navy)", margin: 0, letterSpacing: "-0.02em" }}
              >
                {fullName}
              </h2>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            className="btn btn-secondary tracker-modal-close-btn"
            onClick={onClose}
            aria-label="Close details"
            style={{ padding: "6px", borderRadius: "var(--radius-pill)" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Details Grid */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontSize: "13px" }}>
          {/* Target Event Context */}
          <div
            className="tracker-venue-box"
            style={{
              background: "var(--bg)",
              padding: "12px 14px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-light)",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                color: "var(--secondary)",
                textTransform: "uppercase",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "4px",
                marginBottom: "2px",
              }}
            >
              <MapPin size={12} color="var(--primary)" />
              <span>Venue Target Event</span>
            </span>
            <strong style={{ color: "var(--navy)", fontSize: "14px", display: "block" }}>
              {targetEventName || "Selected Event Venue"}
            </strong>
            {cohortType === "COMBO" && parentEvent && (
              <span style={{ display: "block", fontSize: "12px", color: "var(--primary)", marginTop: "2px" }}>
                Via Combo Package: {parentEvent.name}
              </span>
            )}
          </div>

          {/* Academic & Personal Information */}
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "14px",
              background: "var(--white)",
            }}
          >
            <h3
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: "var(--navy)",
                marginBottom: "12px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <User size={14} color="var(--primary)" />
              <span>Participant Information</span>
            </h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <span style={{ color: "var(--secondary)", fontSize: "11px", display: "block" }}>Email</span>
                <span style={{ color: "var(--text)", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <Mail size={12} color="var(--muted)" />
                  <span style={{ wordBreak: "break-all" }}>{user?.email || "N/A"}</span>
                </span>
              </div>

              <div>
                <span style={{ color: "var(--secondary)", fontSize: "11px", display: "block" }}>Mobile</span>
                <span style={{ color: "var(--text)", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <Phone size={12} color="var(--muted)" />
                  <span>{participantDetails?.mobileNumber || "N/A"}</span>
                </span>
              </div>

              <div>
                <span style={{ color: "var(--secondary)", fontSize: "11px", display: "block" }}>College</span>
                <span style={{ color: "var(--text)", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <Building size={12} color="var(--muted)" />
                  <span>{participantDetails?.collegeName || "N/A"}</span>
                </span>
              </div>

              <div>
                <span style={{ color: "var(--secondary)", fontSize: "11px", display: "block" }}>Department / Year</span>
                <span style={{ color: "var(--text)", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <GraduationCap size={12} color="var(--muted)" />
                  <span>
                    {participantDetails?.department || "N/A"}{" "}
                    {participantDetails?.yearOfStudy ? `(${participantDetails.yearOfStudy})` : ""}
                  </span>
                </span>
              </div>

              {participantDetails?.rollNumber && (
                <div>
                  <span style={{ color: "var(--secondary)", fontSize: "11px", display: "block" }}>Roll Number</span>
                  <span style={{ color: "var(--navy)", fontWeight: 600 }}>{participantDetails.rollNumber}</span>
                </div>
              )}

              {participantDetails?.section && (
                <div>
                  <span style={{ color: "var(--secondary)", fontSize: "11px", display: "block" }}>Section</span>
                  <span style={{ color: "var(--navy)", fontWeight: 600 }}>{participantDetails.section}</span>
                </div>
              )}
            </div>
          </div>

          {/* Registration & Team Metadata */}
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "14px",
              background: "var(--white)",
            }}
          >
            <h3
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: "var(--navy)",
                marginBottom: "12px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <Hash size={14} color="var(--primary)" />
              <span>Registration Metadata</span>
            </h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <span style={{ color: "var(--secondary)", fontSize: "11px", display: "block" }}>Registration ID</span>
                <code
                  className="tracker-ref-code"
                  style={{ fontSize: "11px", background: "var(--bg)", padding: "2px 6px", borderRadius: "3px" }}
                >
                  {_id}
                </code>
              </div>

              <div>
                <span style={{ color: "var(--secondary)", fontSize: "11px", display: "block" }}>Registered On</span>
                <span style={{ color: "var(--text)", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <Calendar size={12} color="var(--muted)" />
                  <span>{formatDate(createdAt)}</span>
                </span>
              </div>

              <div>
                <span style={{ color: "var(--secondary)", fontSize: "11px", display: "block" }}>Registration Type</span>
                <span style={{ color: "var(--navy)", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  {team ? <Users size={12} color="var(--blue)" /> : <User size={12} color="var(--blue)" />}
                  <strong>{team ? `Team (${team.teamName})` : "Individual"}</strong>
                </span>
                {team && isTeamLeader && (
                  <span style={{ fontSize: "11px", color: "var(--blue)", display: "block", fontWeight: 600 }}>
                    Team Leader
                  </span>
                )}
              </div>

              <div>
                <span style={{ color: "var(--secondary)", fontSize: "11px", display: "block" }}>Registration Status</span>
                <span
                  style={{
                    fontWeight: 700,
                    color: status === "REGISTERED" ? "var(--success)" : "var(--error)",
                  }}
                >
                  {status}
                </span>
              </div>

              <div>
                <span style={{ color: "var(--secondary)", fontSize: "11px", display: "block" }}>Payment Status</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 700 }}>
                  <ShieldCheck size={13} color={paymentStatus === "VERIFIED" ? "var(--success)" : "var(--warning)"} />
                  <span>{paymentStatus}</span>
                </span>
              </div>

              <div>
                <span style={{ color: "var(--secondary)", fontSize: "11px", display: "block" }}>Check-in Status</span>
                {attendance.isPresent ? (
                  <span style={{ color: "var(--success)", display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 600 }}>
                    <CheckCircle2 size={13} />
                    <span>Checked in at {formatDate(attendance.checkedInAt || undefined)}</span>
                  </span>
                ) : (
                  <span style={{ color: "#b45309", display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 600 }}>
                    <Clock size={13} />
                    <span>Not checked in</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Close Button */}
        <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            <span>Close Details</span>
          </button>
        </div>
      </div>
    </div>
  );
}
