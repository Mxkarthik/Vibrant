import { api } from "./client";
import type { EventListResult, EventRecord } from "./events";

export type ParticipantRegistrationStatus = "REGISTERED" | "CANCELLED" | "ALL";
export type ParticipantPaymentStatus = "NOT_REQUIRED" | "PENDING" | "VERIFIED" | "REJECTED" | "";

export interface ParticipantFilters {
  page: number;
  limit: number;
  search: string;
  type: "INDIVIDUAL" | "TEAM" | "";
  paymentStatus: ParticipantPaymentStatus;
  attendance: "PRESENT" | "ABSENT" | "";
  status: ParticipantRegistrationStatus;
}

export interface ParticipantRegistration {
  _id: string;
  user?: { name?: string; email?: string } | null;
  participantDetails?: {
    fullName?: string;
    mobileNumber?: string;
    collegeName?: string;
    department?: string;
    section?: string;
    yearOfStudy?: string;
    rollNumber?: string;
  };
  team?: {
    _id: string;
    teamName?: string;
    memberCount?: number;
    leader?: { name?: string; email?: string } | string | null;
    payment?: { status?: string };
  } | null;
  isTeamLeader?: boolean;
  payment?: { method?: string; status?: string };
  attendance?: { isPresent?: boolean; checkedInAt?: string | null };
  status?: string;
  createdAt?: string;
}

export interface ParticipantPageResult {
  success: true;
  event: { id: string; name: string };
  pagination: { total: number; page: number; limit: number; totalPages: number };
  registrations: ParticipantRegistration[];
}

export interface RegistrationDetails extends ParticipantRegistration {
  event?: { name?: string; category?: string; venue?: string; startDate?: string; endDate?: string } | null;
  customResponses?: Array<{ fieldKey?: string; value?: unknown }>;
  certificate?: { isIssued?: boolean; certificateId?: string; issuedAt?: string | null };
  team?: ParticipantRegistration["team"];
}

export interface RegistrationDetailsResult {
  success: true;
  registration: RegistrationDetails;
  teamMembers?: Array<{ name: string; email: string | null; isTeamLeader: boolean }>;
}

export async function getParticipantEvents() {
  const first = await getAdminEventsPage(1);
  const pages = first.pagination.totalPages;
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, index) => getAdminEventsPage(index + 2)));
  return [first, ...rest].flatMap(result => result.events);
}

async function getAdminEventsPage(page: number) {
  const { data } = await api.get<EventListResult>("/admin/events", { params: { page, limit: 50, sortBy: "createdAt", sortOrder: "desc" } });
  return data;
}

export async function getEventParticipants(eventId: string, filters: ParticipantFilters) {
  const { data } = await api.get<ParticipantPageResult>(`/events/${eventId}/participants`, { params: filters });
  return data;
}

export async function getRegistrationDetails(registrationId: string) {
  const { data } = await api.get<RegistrationDetailsResult>(`/registrations/${registrationId}`);
  return data;
}

export async function downloadParticipantExport(eventId: string) {
  return api.get<Blob>(`/events/${eventId}/export`, { responseType: "blob" });
}

export function participantEventLabel(event: EventRecord) {
  return `${event.name} · ${event.registration?.registeredParticipants ?? 0} registered`;
}
