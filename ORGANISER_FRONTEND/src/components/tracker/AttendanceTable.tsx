import {
  User,
  Users,
  CheckCircle2,
  Clock,
  Layers,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import type { EventParticipantRegistration } from "../../api/attendanceService.ts";

interface AttendanceTableProps {
  registrations: EventParticipantRegistration[];
  onSelectRegistration: (reg: EventParticipantRegistration) => void;
  targetEventName?: string;
}

export default function AttendanceTable({
  registrations,
  onSelectRegistration,
}: AttendanceTableProps) {
  const formatTime = (dateStr?: string | null) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleTimeString("en-IN", {
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

  return (
    <div className="attendance-table-container tracker-roster-container">
      {/* Single Approved Modern Participant Card Roster (Universal across Desktop, Tablet, and Mobile) */}
      <div className="mobile-cards-list tracker-cards-list">
        {registrations.map((reg) => {
          const paymentStatus = reg.team
            ? reg.team.payment?.status || "NOT_REQUIRED"
            : reg.payment?.status || "NOT_REQUIRED";

          const isPresent = reg.attendance.isPresent;
          const isCombo = reg.cohortType === "COMBO";
          const fullName = reg.participantDetails?.fullName || reg.user?.name || "Participant";
          const initials = getInitials(fullName);
          const refShort = reg._id.slice(-8);

          return (
            <div
              key={reg._id}
              className="mobile-participant-card tracker-mobile-card"
              onClick={() => onSelectRegistration(reg)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectRegistration(reg);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`View details for ${fullName}`}
            >
              {/* Card Main: Avatar + Name & Ref + Status Pill */}
              <div className="tracker-card-main">
                <div className="tracker-avatar-circle" aria-hidden="true">
                  {initials}
                </div>

                <div className="tracker-card-info">
                  <h3 className="tracker-card-name">
                    {fullName}
                  </h3>
                  <div className="tracker-card-ref-row">
                    <span className="tracker-ref-code">{refShort}</span>
                    {reg.participantDetails?.rollNumber && (
                      <span>{reg.participantDetails.rollNumber}</span>
                    )}
                    {reg.participantDetails?.collegeName && (
                      <span style={{ maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        • {reg.participantDetails.collegeName}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                  {isPresent ? (
                    <span className="tracker-status-badge tracker-status-present">
                      <CheckCircle2 size={12} />
                      <span>Present</span>
                    </span>
                  ) : (
                    <span className="tracker-status-badge tracker-status-absent">
                      <Clock size={12} />
                      <span>Absent</span>
                    </span>
                  )}
                  <ChevronRight size={16} color="var(--muted)" />
                </div>
              </div>

              {/* Card Footer: Cohort, Type, Payment */}
              <div className="tracker-card-footer">
                <div className="tracker-card-tags">
                  {isCombo ? (
                    <span className="badge badge-combo">
                      <Layers size={10} style={{ marginRight: "3px" }} />
                      Combo Pass
                    </span>
                  ) : (
                    <span className="badge badge-category">Direct</span>
                  )}

                  {reg.team ? (
                    <span className="badge" style={{ background: "#f1f5f9", color: "var(--navy)" }}>
                      <Users size={10} style={{ marginRight: "3px" }} />
                      {reg.team.teamName}
                      {reg.isTeamLeader && " (L)"}
                    </span>
                  ) : (
                    <span className="badge" style={{ background: "#f1f5f9", color: "var(--secondary)" }}>
                      <User size={10} style={{ marginRight: "3px" }} />
                      Individual
                    </span>
                  )}

                  <span
                    className="badge"
                    style={{
                      background: paymentStatus === "VERIFIED" ? "#ecfdf5" : "#fef3c7",
                      color: paymentStatus === "VERIFIED" ? "#047857" : "#b45309",
                    }}
                  >
                    <ShieldCheck size={10} style={{ marginRight: "3px" }} />
                    {paymentStatus}
                  </span>
                </div>

                {isPresent && reg.attendance.checkedInAt && (
                  <span style={{ fontSize: "11px", color: "var(--muted)", marginLeft: "auto" }}>
                    {formatTime(reg.attendance.checkedInAt)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
