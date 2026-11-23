import { api } from "./client.ts";
import type { CurrentUser } from "./authService.ts";

export type EventStatus = "PUBLISHED" | "CANCELLED" | "COMPLETED";
export type RegistrationMode = "INDIVIDUAL" | "TEAM";

export interface EventRecord {
  _id: string;
  name: string;
  description?: string;
  category: string;
  venue: string;
  startDate: string;
  endDate: string;
  status: EventStatus;
  registration: {
    mode: RegistrationMode;
    capacity: number;
    registeredParticipants: number;
    deadline: string;
    registrationFee: number;
    minTeamSize?: number;
    maxTeamSize?: number;
  };
  organizers?: Array<{ _id: string; name: string; email: string } | string>;
  multiEventAccess?: {
    enabled: boolean;
    includedEvents: string[];
  };
  includedEventDetails?: Array<{
    _id: string;
    name: string;
    category: string;
    venue: string;
    startDate: string;
    endDate: string;
  }>;
}

export interface AccessibleEventRecord extends EventRecord {
  isExplicitlyAssigned: boolean;
  isLegacyFallback: boolean;
}

export async function getEvents(): Promise<EventRecord[]> {
  const { data } = await api.get<{ success: true; count: number; events: EventRecord[] }>("/events");
  return data.events || [];
}

export async function getEventById(id: string): Promise<EventRecord> {
  const { data } = await api.get<{ success: true; event: EventRecord }>(`/events/${id}`);
  return data.event;
}

/**
 * Filters events by user role and assignment.
 * - ADMIN: Super-user access across all published events.
 * - ORGANISER: Access to explicitly assigned events (via event.organizers)
 *   or legacy unassigned events (empty or missing event.organizers array).
 * Handles populated objects, raw ObjectId strings, and empty arrays safely.
 */
export function filterAccessibleEvents(
  events: EventRecord[],
  user: CurrentUser | null
): AccessibleEventRecord[] {
  if (!user) return [];

  const userId = user.id || (user as any)._id;

  return events
    .filter((event) => {
      // Must be an active published event
      if (event.status !== "PUBLISHED") return false;

      // ADMIN has super-user visibility across all published events
      if (user.role === "ADMIN") return true;

      // ORGANISER visibility:
      // 1. Explicitly assigned to event.organizers (matching string, _id, or id)
      // 2. Legacy fallback: empty or missing organizers array permits access
      if (user.role === "ORGANISER") {
        const orgList = event.organizers || [];
        if (!Array.isArray(orgList) || orgList.length === 0) {
          return true; // Legacy compatibility fallback
        }
        return orgList.some((org) => {
          const orgId = typeof org === "string" ? org : (org?._id || (org as any)?.id);
          return String(orgId) === String(userId);
        });
      }

      return false;
    })
    .map((event) => {
      const orgList = event.organizers || [];
      const hasOrganizers = Array.isArray(orgList) && orgList.length > 0;
      const isExplicitlyAssigned = hasOrganizers && orgList.some((org) => {
        const orgId = typeof org === "string" ? org : (org?._id || (org as any)?.id);
        return String(orgId) === String(userId);
      });
      const isLegacyFallback = !hasOrganizers && user.role === "ORGANISER";

      return {
        ...event,
        isExplicitlyAssigned,
        isLegacyFallback,
      };
    });
}
