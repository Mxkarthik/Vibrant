import { api } from "./client";
import type { EventListResult, EventRecord } from "./events";

export type CertificateStatusFilter = "ALL" | "ISSUED" | "PENDING" | "INELIGIBLE";

export interface CertificateRecord {
  registrationId: string;
  participantName: string;
  email: string | null;
  teamName: string | null;
  isTeamLeader: boolean;
  registrationStatus: string;
  attendance: boolean;
  isEligible: boolean;
  eligibilityReason: string | null;
  certificateId: string | null;
  isIssued: boolean;
  issuedAt: string | null;
}

export interface CertificateListResult {
  success: true;
  event: Pick<EventRecord, "name" | "startDate" | "endDate" | "status">;
  summary: { totalRegistrations: number; eligible: number; issued: number; pending: number; issuancePercentage: number };
  pagination: { total: number; page: number; limit: number; totalPages: number };
  certificates: CertificateRecord[];
}

export interface CertificateIssueResult {
  success: true;
  message: string;
  totalEligible: number;
  totalCandidates: number;
  issuedCount: number;
  skippedCount: number;
  certificates: Array<{ registrationId: string; participant: string; certificateId: string }>;
  skipped: Array<{ registrationId: string; participant: string; reason: string }>;
}

export async function getCertificateEvents() {
  const first = await getEventPage(1);
  const rest = await Promise.all(Array.from({ length: Math.max(0, first.pagination.totalPages - 1) }, (_, index) => getEventPage(index + 2)));
  return [first, ...rest].flatMap(page => page.events);
}

async function getEventPage(page: number) {
  const { data } = await api.get<EventListResult>("/admin/events", { params: { page, limit: 50, sortBy: "createdAt", sortOrder: "desc" } });
  return data;
}

export async function getEventCertificates(eventId: string, params: { page: number; limit: number; search: string; status: CertificateStatusFilter }) {
  const { data } = await api.get<CertificateListResult>(`/admin/events/${eventId}/certificates`, { params });
  return data;
}

export async function issueCertificatesForEvent(eventId: string) {
  const { data } = await api.post<CertificateIssueResult>(`/events/${eventId}/certificates/issue`);
  return data;
}

export async function issueCertificateForRegistration(registrationId: string) {
  const { data } = await api.post<{ success: true; message: string; certificate: { registrationId: string; participantName: string; certificateId: string; issuedAt: string } }>(`/admin/certificates/${registrationId}/issue`);
  return data;
}

export async function downloadCertificate(certificateId: string) {
  return api.get<Blob>(`/registrations/certificate/${encodeURIComponent(certificateId)}/download`, { responseType: "blob" });
}
