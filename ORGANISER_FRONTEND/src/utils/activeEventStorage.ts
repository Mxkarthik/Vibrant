/**
 * Utility for persisting, retrieving, and validating the currently active event in the Organiser Portal.
 * Allows seamless switching between Scanner, Events, Tracker, and Dashboard in the bottom navigation
 * while strictly enforcing that only valid, accessible, physical events can activate scanning.
 */

const ACTIVE_EVENT_KEY = "vibrant_active_event_id";

export function getActiveEventId(): string | null {
  try {
    const sessionVal = sessionStorage.getItem(ACTIVE_EVENT_KEY);
    if (sessionVal && sessionVal.trim()) return sessionVal.trim();
    const localVal = localStorage.getItem(ACTIVE_EVENT_KEY);
    if (localVal && localVal.trim()) return localVal.trim();
    return null;
  } catch {
    return null;
  }
}

export function setActiveEventId(id: string): void {
  if (!id || typeof id !== "string") return;
  const cleanId = id.trim();
  try {
    sessionStorage.setItem(ACTIVE_EVENT_KEY, cleanId);
    localStorage.setItem(ACTIVE_EVENT_KEY, cleanId);
  } catch {
    // Graceful fallback in private/restricted storage modes
  }
}

export function clearActiveEventId(): void {
  try {
    sessionStorage.removeItem(ACTIVE_EVENT_KEY);
    localStorage.removeItem(ACTIVE_EVENT_KEY);
  } catch {
    // Graceful fallback
  }
}

/**
 * Validates the stored active event against accessible events list.
 * Rules:
 * 1. Must exist in accessible events.
 * 2. Must NOT be a Multi-Event Package (combo parent), as combo packages are not scanning venues.
 * If invalid or a package, automatically clears storage and returns null.
 */
export function validateAndGetActiveEventId(
  accessibleEvents: Array<{ _id: string; multiEventAccess?: { enabled: boolean } }>
): string | null {
  const storedId = getActiveEventId();
  if (!storedId) return null;

  if (!Array.isArray(accessibleEvents) || accessibleEvents.length === 0) {
    return null;
  }

  const matchingEvent = accessibleEvents.find((e) => e._id === storedId);
  if (!matchingEvent) {
    clearActiveEventId();
    return null;
  }

  if (Boolean(matchingEvent.multiEventAccess?.enabled)) {
    clearActiveEventId();
    return null;
  }

  return storedId;
}
