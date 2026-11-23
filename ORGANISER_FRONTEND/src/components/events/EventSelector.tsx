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
    <div className="event-selector-container">
      <label htmlFor="event-selector" className="event-selector-label">
        Active Event:
      </label>
      <select
        id="event-selector"
        aria-label="Active Event Selection"
        value={selectedEventId}
        disabled={isLoading || events.length === 0}
        onChange={(e) => onSelectEvent(e.target.value)}
        className="event-selector-select"
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
