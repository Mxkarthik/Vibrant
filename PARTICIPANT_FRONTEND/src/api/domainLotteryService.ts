import { api } from "./client";

export interface ParticipantDomainStatus {
  eventId: string;
  eventEligible: boolean;
  domainsEnabled: boolean;
  visibility: string | null;
  drawStatus: string | null;
  isEligible: boolean;
  entryType: "INDIVIDUAL" | "TEAM" | null;
  canDraw: boolean;
  hasAssignment: boolean;
  canReadAllDomains: boolean;
  reasonCode: string;
  message?: string;
}

export interface AssignedTheme {
  title: string;
  problemStatement: string;
  instructions: string;
}

export interface ParticipantLockedTheme {
  eventId: string;
  hasAssignment: boolean;
  isLocked: boolean;
  theme: AssignedTheme | null;
  assignedAt: string | null;
}

export interface ParticipantDrawResult extends ParticipantLockedTheme {
  alreadyAssigned: boolean;
}

export async function getParticipantDomainStatus(eventId: string, signal?: AbortSignal): Promise<ParticipantDomainStatus> {
  const { data } = await api.get<{ success: true; data: ParticipantDomainStatus }>(
    `/participant/events/${encodeURIComponent(eventId)}/domains/status`, { signal },
  );
  return data.data;
}

export async function getParticipantMyTheme(eventId: string, signal?: AbortSignal): Promise<ParticipantLockedTheme> {
  const { data } = await api.get<{ success: true; data: ParticipantLockedTheme }>(
    `/participant/events/${encodeURIComponent(eventId)}/domains/my-theme`, { signal },
  );
  return data.data;
}

export async function drawParticipantTheme(eventId: string): Promise<ParticipantDrawResult> {
  const { data } = await api.post<{ success: true; data: ParticipantDrawResult }>(
    `/participant/events/${encodeURIComponent(eventId)}/domains/draw`, {},
    { headers: { "Content-Type": "application/json" } },
  );
  return data.data;
}
