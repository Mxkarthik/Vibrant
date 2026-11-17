import { api } from "./client";

export const EVENT_CATEGORIES = ["TECHNICAL", "CULTURAL", "WORKSHOP", "SPORTS", "COMPETITION"] as const;
export type EventCategory = typeof EVENT_CATEGORIES[number];
export type EventFilter = "" | "upcoming" | "open" | "closing-soon" | "free" | "paid";
export type EventSort = "upcoming" | "latest" | "name";

export interface DiscoverableEvent {
  _id: string;
  name: string;
  description: string;
  category: EventCategory;
  poster: string | null;
  paymentQrUrl?: string | null;
  venue: string;
  startDate: string;
  endDate: string;
  registration: {
    mode: "INDIVIDUAL" | "TEAM";
    registeredParticipants?: number;
    deadline: string;
    capacity?: number;
    registrationFee: number;
    minTeamSize?: number;
    maxTeamSize?: number;
  };
  status: "PUBLISHED" | "CANCELLED" | "COMPLETED";
  createdAt: string;
}

export interface EventRegistrationField {
  fieldId: string;
  label: string;
  fieldKey: string;
  fieldType: "TEXT" | "TEXTAREA" | "NUMBER" | "DROPDOWN" | "RADIO" | "CHECKBOX" | "DATE" | "URL";
  required: boolean;
  options: string[];
  order: number;
}

export interface EventDetails extends DiscoverableEvent {
  registration: DiscoverableEvent["registration"] & {
    minTeamSize?: number;
    maxTeamSize?: number;
  };
  registrationFields?: EventRegistrationField[];
  updatedAt?: string;
}

export interface EventListResponse {
  success: true;
  pagination: {
    totalEvents: number;
    currentPage: number;
    totalPages: number;
    limit: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  events: DiscoverableEvent[];
}

export async function getDiscoverableEvents(params: {
  search?: string;
  category?: EventCategory | "";
  filter?: EventFilter;
  sortBy?: EventSort;
  page: number;
  limit: number;
}, signal?: AbortSignal) {
  const { data } = await api.get<EventListResponse>("/events/filtered", { params, signal });
  return data;
}

export async function getEventDetails(eventId: string, signal?: AbortSignal) {
  const { data } = await api.get<{ success: true; event: EventDetails }>(`/events/${encodeURIComponent(eventId)}`, { signal });
  return data.event;
}
