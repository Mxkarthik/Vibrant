import { api } from "./client.ts";

export interface AttendanceCohortStats {
  total: number;
  present: number;
  absent: number;
}

export interface AttendanceStatistics {
  totalParticipants: number;
  present: number;
  absent: number;
  attendancePercentage: number;
  direct: AttendanceCohortStats;
  combo: AttendanceCohortStats;
  individual: AttendanceCohortStats;
  team: AttendanceCohortStats;
  admissionEligible?: AttendanceCohortStats;
  // Defensive compatibility aliases:
  presentParticipants?: number;
  pendingParticipants?: number;
  attendanceRate?: number;
}

export interface AttendanceParticipantRecord {
  name: string;
  mobileNumber?: string;
  collegeName?: string;
  department?: string;
  rollNumber?: string;
  teamName: string | null;
  isTeamLeader: boolean;
  attendance: "PRESENT" | "ABSENT";
  checkedInAt: string | null;
  registrationType: "INDIVIDUAL" | "TEAM";
  cohortType: "DIRECT" | "COMBO";
  parentEventName: string | null;
}

export interface AttendanceReport {
  success: true;
  event: string;
  statistics: AttendanceStatistics;
  participants: AttendanceParticipantRecord[];
}

export interface MarkAttendancePayload {
  qrToken: string;
  eventId?: string;
}

export interface MarkAttendanceResponse {
  success: boolean;
  message: string;
  participant?: {
    fullName: string;
    registrationId: string;
  };
  event?: {
    id: string;
    name: string;
  };
  checkedInAt?: string;
  accessType?: string;
  comboProgress?: {
    attendedCount: number;
    totalEligible: number;
    isComplete: boolean;
  };
}

/**
 * Fetches attendance statistics and participant list for a specific event.
 * Endpoint: GET /api/events/:id/attendance
 * Access: ADMIN or assigned ORGANISER (with legacy empty-organizer fallback).
 */
export async function getEventAttendance(eventId: string): Promise<AttendanceReport> {
  const { data } = await api.get<AttendanceReport>(`/events/${eventId}/attendance`);
  return data;
}

/**
 * Downloads binary Excel attendance report (.xlsx) for an event.
 * Endpoint: GET /api/events/:id/export
 * Access: ADMIN or assigned ORGANISER.
 */
export async function exportEventAttendance(eventId: string, eventName?: string): Promise<void> {
  try {
    const response = await api.get<Blob>(`/events/${eventId}/export`, {
      responseType: "blob",
    });

    if (!response.data || !(response.data instanceof Blob) || response.data.size === 0) {
      throw new Error("Export response contains no spreadsheet data.");
    }

    const objectUrl = URL.createObjectURL(response.data);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    const safeName = (eventName || "Event").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "Event";
    anchor.download = `VIBRANT_${safeName}_Participants.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (err: any) {
    // When responseType: 'blob' is configured, axios error response.data is a Blob containing error JSON
    if (err?.response?.data instanceof Blob) {
      try {
        const text = await err.response.data.text();
        const json = JSON.parse(text);
        if (json?.message) {
          throw new Error(json.message);
        }
      } catch (parseErr: any) {
        if (parseErr instanceof Error && parseErr.message !== err.message && parseErr.message !== "Unexpected end of JSON input") {
          throw parseErr;
        }
      }
    }
    throw err;
  }
}

/**
 * Submits QR attendance check-in scan for an event.
 * Real backend endpoint: POST /api/registrations/attendance
 * Access: ADMIN or assigned ORGANISER.
 */
export async function markAttendanceCheckIn(payload: MarkAttendancePayload): Promise<MarkAttendanceResponse> {
  const { data } = await api.post<MarkAttendanceResponse>("/registrations/attendance", payload);
  return data;
}

export interface ManualLookupPayload {
  registrationId: string;
  eventId: string;
}

export interface ManualLookupParticipant {
  fullName: string;
  collegeName: string | null;
  department: string | null;
  rollNumber: string | null;
  maskedMobile: string | null;
}

export interface ManualLookupRegistrationInfo {
  registrationType: "INDIVIDUAL" | "TEAM";
  teamName: string | null;
  isTeamLeader: boolean;
  cohortType: "DIRECT" | "COMBO";
  comboName: string | null;
  paymentStatus?: "NOT_REQUIRED" | "PENDING" | "VERIFIED" | "REJECTED";
}

export interface ManualLookupEligibility {
  isEntitled: boolean;
  paymentStatus: "NOT_REQUIRED" | "PENDING" | "VERIFIED" | "REJECTED";
  alreadyCheckedIn: boolean;
  checkedInAt: string | null;
  canCheckIn: boolean;
  reasonCode: string;
  message: string;
}

export interface ManualLookupResponse {
  success: boolean;
  data: {
    registrationId: string;
    participant: ManualLookupParticipant;
    registration: ManualLookupRegistrationInfo;
    event: {
      id: string;
      name: string;
    };
    eligibility: ManualLookupEligibility;
  };
}

export interface ManualAttendancePayload {
  registrationId: string;
  eventId: string;
  identityConfirmed: boolean;
}

/**
 * Searches and pre-flight validates a registration by ID for manual check-in.
 * Endpoint: POST /api/registrations/manual-lookup
 * Access: ADMIN or assigned ORGANISER.
 */
export async function lookupRegistrationForManualCheckIn(
  payload: ManualLookupPayload
): Promise<ManualLookupResponse> {
  const { data } = await api.post<ManualLookupResponse>("/registrations/manual-lookup", payload);
  return data;
}

/**
 * Submits confirmed manual check-in by Registration ID for a participant.
 * Endpoint: POST /api/registrations/manual-attendance
 * Access: ADMIN or assigned ORGANISER.
 */
export async function markManualAttendanceCheckIn(
  payload: ManualAttendancePayload
): Promise<MarkAttendanceResponse> {
  const { data } = await api.post<MarkAttendanceResponse>("/registrations/manual-attendance", payload);
  return data;
}


// ============================================================================
// PARTICIPANT LIST & ATTENDANCE TRACKER CONTRACTS
// ============================================================================

export interface ParticipantDetails {
  fullName: string;
  mobileNumber?: string;
  collegeName?: string;
  department?: string;
  section?: string;
  yearOfStudy?: string;
  rollNumber?: string;
}

export interface UserSummary {
  _id: string;
  name: string;
  email: string;
}

export interface TeamSummary {
  _id: string;
  teamName: string;
  memberCount: number;
  leader?: {
    _id?: string;
    name: string;
    email: string;
  };
  payment?: {
    status: "NOT_REQUIRED" | "PENDING" | "VERIFIED" | "REJECTED";
  };
}

export interface RegistrationPaymentSummary {
  method?: string;
  status: "NOT_REQUIRED" | "PENDING" | "VERIFIED" | "REJECTED";
  receivedAmount?: number | null;
  expectedAmount?: number | null;
  verifiedAt?: string | null;
}

export interface EventParticipantRegistration {
  _id: string;
  user?: UserSummary;
  participantDetails?: ParticipantDetails;
  team?: TeamSummary | null;
  isTeamLeader?: boolean;
  payment?: RegistrationPaymentSummary;
  status: "REGISTERED" | "CANCELLED";
  attendance: {
    isPresent: boolean;
    checkedInAt: string | null;
  };
  cohortType: "DIRECT" | "COMBO";
  parentEvent?: {
    _id: string;
    name: string;
  } | null;
  createdAt: string;
}

export interface EventParticipantsPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface EventParticipantsResponse {
  success: boolean;
  event: {
    id: string;
    name: string;
  };
  pagination: EventParticipantsPagination;
  registrations: EventParticipantRegistration[];
}

export interface EventParticipantsQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  type?: "INDIVIDUAL" | "TEAM" | "";
  paymentStatus?: "NOT_REQUIRED" | "PENDING" | "VERIFIED" | "REJECTED" | "";
  attendance?: "PRESENT" | "ABSENT" | "";
  status?: "REGISTERED" | "CANCELLED" | "ALL";
}

/**
 * Fetches paginated participant list for an event with server-side filters.
 * Endpoint: GET /api/events/:id/participants
 * Access: ADMIN or assigned ORGANISER.
 */
export async function getEventParticipants(
  eventId: string,
  params: EventParticipantsQueryParams = {}
): Promise<EventParticipantsResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));
  if (params.search && params.search.trim()) query.set("search", params.search.trim());
  if (params.type) query.set("type", params.type);
  if (params.paymentStatus) query.set("paymentStatus", params.paymentStatus);
  if (params.attendance) query.set("attendance", params.attendance);
  if (params.status) query.set("status", params.status);

  const qs = query.toString();
  const url = `/events/${eventId}/participants${qs ? `?${qs}` : ""}`;
  const { data } = await api.get<EventParticipantsResponse>(url);
  return data;
}
