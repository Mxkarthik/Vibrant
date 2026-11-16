import type { EventStatus } from "../../api/events";

export default function EventStatusBadge({ status }: { status: EventStatus }) {
  return <span className={`event-status status-${status.toLowerCase()}`}>{status.charAt(0) + status.slice(1).toLowerCase()}</span>;
}
