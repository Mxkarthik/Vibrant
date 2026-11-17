import type { PaymentStatus } from "../../api/payments";

interface PaymentStatusBadgeProps {
  status: PaymentStatus | string;
  className?: string;
}

export function formatStatus(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

export default function PaymentStatusBadge({ status, className = "" }: PaymentStatusBadgeProps) {
  const normalized = (status || "UNKNOWN").toUpperCase();
  const statusClass = `payment-${normalized.toLowerCase().replace(/_/g, "-")}`;
  return (
    <span className={`payment-status-badge ${statusClass}${className ? ` ${className}` : ""}`}>
      {formatStatus(normalized)}
    </span>
  );
}
