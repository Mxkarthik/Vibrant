import {
  Check,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Calendar,
  Clock,
  Layers,
  QrCode,
  User,
  ShieldAlert,
} from "lucide-react";
import type { MappedScanResult } from "../../utils/scanResultMapping.ts";

interface ScanResultPanelProps {
  result: MappedScanResult;
  onReset: () => void;
  selectedEventName?: string;
}

export default function ScanResultPanel({
  result,
  onReset,
  selectedEventName,
}: ScanResultPanelProps) {
  const {
    outcome,
    title,
    message,
    participantName,
    registrationId,
    eventName,
    checkedInAt,
    accessType,
    isCombo,
    comboProgress,
    reasonCode,
  } = result;

  const formatDateTime = (iso?: string) => {
    if (!iso) return "Just now";
    try {
      const d = new Date(iso);
      const datePart = d.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      const timePart = d.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `${datePart}, ${timePart}`;
    } catch {
      return iso;
    }
  };

  const getToneBadge = () => {
    switch (outcome) {
      case "SUCCESS":
        return {
          badgeClass: "result-badge-circle result-badge-success",
          icon: <Check size={28} strokeWidth={2.8} />,
          statusPillClass: "result-status-pill result-status-pill-success",
          statusText: "✔ Checked In",
        };
      case "DUPLICATE":
        return {
          badgeClass: "result-badge-circle result-badge-duplicate",
          icon: <AlertTriangle size={28} strokeWidth={2.5} />,
          statusPillClass: "result-status-pill result-status-pill-warning",
          statusText: "Already Scanned",
        };
      case "AMBIGUOUS":
        return {
          badgeClass: "result-badge-circle result-badge-ambiguous",
          icon: <HelpCircle size={28} strokeWidth={2.5} />,
          statusPillClass: "result-status-pill result-status-pill-warning",
          statusText: "Pending Check",
        };
      case "REJECTED":
      default:
        return {
          badgeClass: "result-badge-circle result-badge-rejected",
          icon: <XCircle size={28} strokeWidth={2.5} />,
          statusPillClass: "result-status-pill result-status-pill-error",
          statusText: "Entry Rejected",
        };
    }
  };

  const tone = getToneBadge();

  const registrationTypeLabel = isCombo
    ? "Combo Pass"
    : accessType === "MULTI_EVENT"
    ? "Combo Pass"
    : accessType === "TEAM"
    ? "Team Pass"
    : "Direct Registration";

  return (
    <div
      className="scan-result-card"
      role="region"
      aria-label="Attendance Scan Result Details"
    >
      {/* 1. Large Circular Outcome Badge */}
      <div className={tone.badgeClass} aria-hidden="true">
        {tone.icon}
      </div>

      {/* 2. Headline & Message */}
      <h2 className="result-title">
        {outcome === "SUCCESS"
          ? "Check-in Successful"
          : outcome === "DUPLICATE"
          ? "Already Checked In"
          : title}
      </h2>

      {message && <p className="result-message">{message}</p>}

      {/* 3. Reason Code Badge if rejected or duplicate */}
      {reasonCode && (
        <div style={{ marginBottom: "16px" }}>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: "var(--radius-pill)",
              background: "var(--bg-subtle)",
              color: outcome === "REJECTED" ? "var(--error)" : "var(--warning)",
              border: `1px solid ${outcome === "REJECTED" ? "var(--error-border)" : "var(--warning-border)"}`,
              fontFamily: "monospace",
            }}
          >
            {reasonCode}
          </span>
        </div>
      )}

      {/* 4. Participant Information Card (Matching Visual Reference Screen 3) */}
      {(participantName || registrationId) && (
        <div className="result-participant-box">
          <div className="result-participant-left">
            <div className="result-avatar-circle">
              {participantName ? participantName.charAt(0).toUpperCase() : <User size={18} />}
            </div>
            <div>
              <span className="result-participant-name">
                {participantName || "Attendee"}
              </span>
              {registrationId && (
                <span className="result-participant-id">
                  {registrationId}
                </span>
              )}
            </div>
          </div>

          <span className={tone.statusPillClass}>
            {tone.statusText}
          </span>
        </div>
      )}

      {/* 5. Detailed Attributes Table */}
      <table className="result-details-table">
        <tbody>
          <tr>
            <td className="result-detail-label">
              <Calendar size={14} color="var(--primary)" />
              <span>Event</span>
            </td>
            <td className="result-detail-value">
              {eventName || selectedEventName || "Selected Venue"}
            </td>
          </tr>

          {checkedInAt && (
            <tr>
              <td className="result-detail-label">
                <Clock size={14} color="var(--primary)" />
                <span>Checked In</span>
              </td>
              <td className="result-detail-value">
                {formatDateTime(checkedInAt)}
              </td>
            </tr>
          )}

          <tr>
            <td className="result-detail-label">
              <Layers size={14} color="var(--primary)" />
              <span>Registration Type</span>
            </td>
            <td className="result-detail-value">
              {registrationTypeLabel}
            </td>
          </tr>
        </tbody>
      </table>

      {/* 6. Multi-Event Combo Progress Bar (When Applicable) */}
      {comboProgress && (
        <div
          style={{
            width: "100%",
            background: "#FAF5FF",
            border: "1px solid #D8B4FE",
            borderRadius: "var(--radius-sm)",
            padding: "12px 14px",
            marginBottom: "20px",
            textAlign: "left",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <span
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "#6B21A8",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <Layers size={14} />
              <span>Combo Pass Progress</span>
            </span>
            <span style={{ fontSize: "12px", fontWeight: 800, color: "#7E22CE" }}>
              {comboProgress.displayString}
            </span>
          </div>

          <div className="progress-track" style={{ height: "8px", background: "#E9D5FF" }}>
            <div
              className="progress-bar"
              style={{
                width: `${Math.min(
                  100,
                  Math.max(
                    0,
                    (comboProgress.attendedCount / (comboProgress.totalEligible || 1)) * 100
                  )
                )}%`,
                background: comboProgress.isComplete ? "var(--success)" : "var(--primary)",
              }}
            />
          </div>

          {comboProgress.isComplete && (
            <div style={{ fontSize: "11px", color: "#047857", fontWeight: 700, marginTop: "6px" }}>
              All included venues attended. Full pass requirement fulfilled.
            </div>
          )}
        </div>
      )}

      {/* 7. Ambiguous State Guard */}
      {outcome === "AMBIGUOUS" && (
        <div
          style={{
            width: "100%",
            fontSize: "12px",
            color: "#0369A1",
            background: "#E0F2FE",
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            marginBottom: "18px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            textAlign: "left",
          }}
        >
          <ShieldAlert size={16} style={{ flexShrink: 0 }} />
          <span>Network connection timed out. Do not re-scan automatically; inspect attendance tracker to confirm check-in.</span>
        </div>
      )}

      {/* 8. Next Participant Action (Matching Visual Reference Screen 3) */}
      <button
        type="button"
        className="btn-next-participant"
        onClick={onReset}
        autoFocus
        aria-label="Proceed to Next Participant Check-in"
      >
        <QrCode size={18} strokeWidth={2.4} />
        <span>Next Participant</span>
      </button>
    </div>
  );
}
