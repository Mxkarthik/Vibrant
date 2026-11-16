import { api } from "./client";

export type EventStatus = "PUBLISHED" | "CANCELLED" | "COMPLETED";
export type EventCategory = "TECHNICAL" | "CULTURAL" | "SPORTS" | "WORKSHOP" | "COMPETITION";
export type RegistrationMode = "INDIVIDUAL" | "TEAM";
export type RegistrationFieldType = "TEXT" | "TEXTAREA" | "NUMBER" | "DROPDOWN" | "RADIO" | "CHECKBOX" | "DATE" | "URL";

export interface RegistrationField {
  fieldId?: string;
  label: string;
  fieldKey: string;
  fieldType: RegistrationFieldType;
  required: boolean;
  options: string[];
  order: number;
}

export interface EventRecord {
  _id: string;
  name: string;
  description: string;
  category: EventCategory;
  poster?: string | null;
  venue: string;
  startDate: string;
  endDate: string;
  status: EventStatus;
  createdAt: string;
  registration: {
    mode: RegistrationMode;
    registeredParticipants: number;
    deadline: string;
    capacity: number;
    registrationFee: number;
    minTeamSize: number;
    maxTeamSize: number;
  };
  registrationFields: RegistrationField[];
}

export interface EventListParams {
  search?: string;
  status?: EventStatus | "";
  category?: EventCategory | "";
  page?: number;
  limit?: number;
  sortBy?: "createdAt" | "startDate";
  sortOrder?: "asc" | "desc";
}

export interface EventListResult {
  success: true;
  events: EventRecord[];
  pagination: {
    totalEvents: number;
    currentPage: number;
    totalPages: number;
    limit: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface CreateEventPayload {
  name: string;
  description: string;
  category: EventCategory;
  poster?: string | null;
  venue: string;
  startDate: string;
  endDate: string;
  registration: {
    mode: RegistrationMode;
    deadline: string;
    capacity: number;
    registrationFee: number;
    minTeamSize?: number;
    maxTeamSize?: number;
  };
  registrationFields: RegistrationField[];
}

export async function getAdminEvents(params: EventListParams = {}) {
  const { data } = await api.get<EventListResult>("/admin/events", { params });
  return data;
}

export async function getEvent(id: string) {
  const { data } = await api.get<{ success: true; event: EventRecord }>(`/events/${id}`);
  return data.event;
}

export async function createEvent(payload: CreateEventPayload) {
  const { data } = await api.post<{ success: true; message: string; event: EventRecord }>("/events", payload);
  return data;
}

export type UpdateEventPayload = Partial<Omit<CreateEventPayload, "registration">> & {
  registration?: Partial<CreateEventPayload["registration"]>;
};

export async function updateEvent(id: string, payload: UpdateEventPayload) {
  const { data } = await api.patch<{ success: true; message: string; event: EventRecord }>(`/events/${id}`, payload);
  return data;
}

export async function cancelEvent(id: string) {
  const { data } = await api.patch<{ success: true; message: string; event: EventRecord }>(`/events/${id}/cancel`);
  return data;
}

export async function completeEvent(id: string) {
  const { data } = await api.patch<{ success: true; message: string; event: EventRecord }>(`/events/${id}/complete`);
  return data;
}

export async function deleteEvent(id: string) {
  const { data } = await api.delete<{ success: true; message: string }>(`/admin/events/${id}`);
  return data;
}

export function getApiErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: { message?: string; errors?: string[] } } }).response;
    const messages = response?.data?.errors;
    if (Array.isArray(messages) && messages.length) return messages.join(" ");
    if (response?.data?.message) return response.data.message;
  }
  return fallback;
}
