import { api } from "./client";
import { notifyRegistrationChanged } from "./registrationStateEvents";
import type { IndividualRegistrationRequest } from "./registrationService";
import type { DigitalTicket, TicketAccess } from "./registrationService";

export interface TeamMemberRegistrationRequest {
  participantDetails: IndividualRegistrationRequest["participantDetails"];
  customResponses: IndividualRegistrationRequest["customResponses"];
}

export interface TeamRegistrationRequest {
  teamName: string;
  members: TeamMemberRegistrationRequest[];
  paymentMethod: "UPI" | "CASH" | "NONE";
  cashReceiverName?: string;
}

export interface CreatedTeamReceipt {
  id: string;
  teamName: string;
  memberCount: number;
  status: string;
  paymentStatus: string;
}

export interface LeaderTeamDetails extends CreatedTeamReceipt {
  createdAt: string;
  paymentMethod: string;
  paymentProofUrl: string | null;
  cashReceiverName: string | null;
  amount: number | null;
  event: {
    id: string;
    name: string;
    category: string;
    poster: string | null;
    venue: string;
    startDate: string;
    endDate: string;
    status: string;
    paymentQrUrl?: string | null;
  } | null;
  members: Array<{
    registrationId: string;
    participantDetails: IndividualRegistrationRequest["participantDetails"];
    isTeamLeader: boolean;
    status: string;
    registeredAt: string;
  }>;
}

export interface TeamTicketsResponse {
  team: {
    name: string;
    memberCount: number;
    paymentStatus: string;
    ticketStatus: "VALID" | "HISTORICAL";
    event: DigitalTicket["event"];
  };
  tickets: Array<Pick<DigitalTicket, "registrationId" | "attendeeName" | "isTeamLeader" | "registrationStatus" | "qrToken"> & {
    access?: TicketAccess;
  }>;
  unavailableCount: number;
}

export async function createTeamRegistration(eventId: string, request: TeamRegistrationRequest, paymentProof?: File, onProgress?: (percent: number) => void): Promise<CreatedTeamReceipt> {
  const body = new FormData();
  body.append("teamName", request.teamName);
  body.append("members", JSON.stringify(request.members));
  body.append("paymentMethod", request.paymentMethod);
  if (request.cashReceiverName) body.append("cashReceiverName", request.cashReceiverName);
  if (paymentProof) body.append("screenshot", paymentProof);
  const { data } = await api.post<{
    success: true;
    team: { id: string; teamName: string; memberCount: number; payment?: { status?: string } };
  }>(`/events/${encodeURIComponent(eventId)}/register-team`, body, {
    onUploadProgress: progress => { if (progress.total) onProgress?.(Math.round(progress.loaded / progress.total * 100)); },
  });
  notifyRegistrationChanged();
  return {
    id: data.team.id,
    teamName: data.team.teamName,
    memberCount: data.team.memberCount,
    status: "REGISTERED",
    paymentStatus: data.team.payment?.status || "NOT_REQUIRED",
  };
}

export async function getLeaderTeam(teamId: string, signal?: AbortSignal): Promise<LeaderTeamDetails> {
  const { data } = await api.get<{
    success: true;
    team: {
      id: string;
      teamName: string;
      memberCount: number;
      status: string;
      createdAt: string;
      payment: { method: string; status: string; proofUrl?: string | null; cashReceiverName?: string | null };
      event: null | { _id: string; name: string; category: string; poster?: string | null; venue: string; startDate: string; endDate: string; status: string; paymentQrUrl?: string | null; registration?: { registrationFee?: number } };
      members: LeaderTeamDetails["members"];
    };
  }>(`/teams/${encodeURIComponent(teamId)}`, { signal });
  const team = data.team;
  return {
    id: team.id,
    teamName: team.teamName,
    memberCount: team.memberCount,
    status: team.status,
    createdAt: team.createdAt,
    paymentMethod: team.payment.method,
    paymentStatus: team.payment.status,
    paymentProofUrl: team.payment.proofUrl || null,
    cashReceiverName: team.payment.cashReceiverName || null,
    amount: team.payment.status === "NOT_REQUIRED" ? 0 : null,
    event: team.event ? { ...team.event, id: team.event._id, poster: team.event.poster || null } : null,
    members: team.members,
  };
}

export async function getLeaderTeamTickets(teamId: string, signal?: AbortSignal): Promise<TeamTicketsResponse> {
  const { data } = await api.get<TeamTicketsResponse & { success: true }>(`/teams/${encodeURIComponent(teamId)}/tickets`, { signal });
  return data;
}

export async function uploadTeamPaymentProof(teamId: string, file: File, onProgress?: (percent: number) => void) {
  const formData = new FormData();
  formData.append("screenshot", file);
  const { data } = await api.post<{ success: true; message: string; proofUrl: string }>(`/teams/${encodeURIComponent(teamId)}/payment-proof`, formData, {
    onUploadProgress: (event) => { if (event.total) onProgress?.(Math.round((event.loaded / event.total) * 100)); },
  });
  return data;
}
