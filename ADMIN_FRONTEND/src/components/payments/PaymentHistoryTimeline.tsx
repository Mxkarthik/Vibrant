import { ArrowRight, Clock3, ShieldCheck } from "lucide-react";
import type { PaymentHistoryEntry } from "../../api/payments";
import PaymentStatusBadge from "./PaymentStatusBadge";

interface PaymentHistoryTimelineProps {
  history?: PaymentHistoryEntry[];
}

export function formatHistoryDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatAdminName(changedBy: PaymentHistoryEntry["changedBy"]): string {
  if (!changedBy) return "Administrator";
  if (typeof changedBy === "object") {
    if (changedBy.name && changedBy.email) {
      return `${changedBy.name} (${changedBy.email})`;
    }
    if (changedBy.name) return changedBy.name;
    if (changedBy.email) return changedBy.email;
    if (changedBy._id) return `Admin ID: ${changedBy._id}`;
  }
  if (typeof changedBy === "string" && changedBy.trim()) {
    return `Admin ID: ${changedBy.trim()}`;
  }
  return "Administrator";
}

export default function PaymentHistoryTimeline({ history }: PaymentHistoryTimelineProps) {
  if (!history || history.length === 0) {
    return (
      <div className="payment-history-empty" role="status">
        <Clock3 size={15} />
        <span>No payment decision history recorded yet.</span>
      </div>
    );
  }

  // Display entries in chronological order
  return (
    <div className="payment-history-timeline" role="feed" aria-label="Payment decision history">
      {history.map((entry, index) => {
        const adminDisplay = formatAdminName(entry.changedBy);
        const formattedDate = formatHistoryDate(entry.changedAt);
        const entryKey = `${entry.changedAt}-${entry.fromStatus}-${entry.toStatus}-${index}`;

        return (
          <div className="payment-history-item" key={entryKey}>
            <div className="payment-history-indicator">
              <span className="payment-history-dot" />
              {index < history.length - 1 && <span className="payment-history-line" />}
            </div>
            <div className="payment-history-content">
              <div className="payment-history-header">
                <div className="payment-history-transition">
                  <PaymentStatusBadge status={entry.fromStatus} />
                  <ArrowRight size={13} className="payment-history-arrow" aria-hidden="true" />
                  <PaymentStatusBadge status={entry.toStatus} />
                </div>
              </div>

              <div className="payment-history-meta">
                <span className="payment-history-admin">
                  <ShieldCheck size={13} aria-hidden="true" />
                  <span>Changed by:</span>
                  <strong>{adminDisplay}</strong>
                </span>
                <span className="payment-history-date">
                  <Clock3 size={13} aria-hidden="true" />
                  <span>Date:</span>
                  <strong>{formattedDate}</strong>
                </span>
              </div>

              {entry.reason && (
                <div className="payment-history-reason">
                  <strong>Reason:</strong> {entry.reason}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
