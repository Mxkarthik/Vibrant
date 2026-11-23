import type { AccessibleEventRecord } from "../../api/eventService";

interface EventSelectorProps {
  events: AccessibleEventRecord[];
  selectedEventId: string;
  onSelectEvent: (eventId: string) => void;
  isLoading?: boolean;
}

export default function EventSelector({
  events,
  selectedEventId,
  onSelectEvent,
  isLoading,
}: EventSelectorProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
      <label htmlFor="event-selector" style={{ fontSize: "12px", fontWeight: 700, color: "var(--secondary)" }}>
        Active Event:
      </label>
      <select
        id="event-selector"
        aria-label="Active Event Selection"
        value={selectedEventId}
        disabled={isLoading || events.length === 0}
        onChange={(e) => onSelectEvent(e.target.value)}
        style={{
          padding: "7px 12px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          background: "var(--white)",
          color: "var(--navy)",
          fontSize: "13px",
          fontWeight: 600,
          outline: "none",
          cursor: "pointer",
          boxShadow: "var(--shadow-xs)",
        }}
      >
        <option value="" disabled>
          {isLoading ? "Loading events…" : events.length === 0 ? "No accessible events" : "Choose an event"}
        </option>
        {events.map((evt) => {
          const isPkg = Boolean(evt.multiEventAccess?.enabled);
          return (
            <option key={evt._id} value={evt._id}>
              {isPkg ? `[Package] ${evt.name} — Not a Scanning Venue` : evt.name}
            </option>
          );
        })}
      </select>
    </div>
  );
}
