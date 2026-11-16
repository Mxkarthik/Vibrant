import { api } from "./client";
import type { EventListResult, EventRecord } from "./events";

export interface AttendanceParticipant {
  registrationId: string;
  name: string;
  email: string | null;
  teamName: string | null;
  isTeamLeader: boolean;
  registrationType: "INDIVIDUAL" | "TEAM";
  attendance: "PRESENT" | "ABSENT";
  checkedInAt: string | null;
}

export interface AttendanceReport {
  success: true;
  event: { _id: string; name: string; startDate: string; endDate: string; status: EventRecord["status"] };
  statistics: {
    totalParticipants: number;
    present: number;
    absent: number;
    attendancePercentage: number;
    individual: { total: number; present: number; absent: number };
    team: { total: number; present: number; absent: number };
  };
  pagination: { total: number; page: number; limit: number; totalPages: number };
  participants: AttendanceParticipant[];
}

export interface AttendanceParams {
  page: number;
  limit: number;
  search: string;
  attendance: "ALL" | "PRESENT" | "ABSENT";
}

export interface CheckInResult {
  success: true;
  message: string;
  participant: { fullName?: string };
  event: string;
  checkedInAt: string;
}

export async function getAttendanceEvents() {
  const first = await getEventPage(1);
  const rest = await Promise.all(Array.from({ length: Math.max(0, first.pagination.totalPages - 1) }, (_, index) => getEventPage(index + 2)));
  return [first, ...rest].flatMap(page => page.events);
}

async function getEventPage(page: number) {
  const { data } = await api.get<EventListResult>("/admin/events", { params: { page, limit: 50, sortBy: "createdAt", sortOrder: "desc" } });
  return data;
}

export async function getAttendanceReport(eventId: string, params: AttendanceParams) {
  const { data } = await api.get<AttendanceReport>(`/admin/events/${eventId}/attendance`, { params });
  return data;
}

export async function submitAttendanceToken(qrToken: string) {
  const { data } = await api.post<CheckInResult>("/registrations/attendance", { qrToken });
  return data;
}

export async function downloadAttendanceExport(eventId: string) {
  return api.get<Blob>(`/events/${eventId}/export`, { responseType: "blob" });
}

export function eventExportFilename(eventName: string) {
  const safeName = eventName.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "Event";
  return `VIBRANT_${safeName}_Attendance.xlsx`;
}
