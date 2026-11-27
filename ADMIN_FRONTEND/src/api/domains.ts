import { api } from "./client";

export interface AdminDomain {
  _id: string;
  event: string;
  title: string;
  problemStatement: string;
  instructions?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DomainConfig {
  enabled: boolean;
  visibility: "PRIVATE" | "PUBLIC" | "READABLE";
  drawStatus: "OPEN" | "CLOSED";
  publishedAt: string | null;
  drawOpenedAt: string | null;
  drawClosedAt: string | null;
  readEnabledAt: string | null;
  poolVersion: number;
  revisionPending: boolean;
}

export interface DomainStatus extends DomainConfig {
  eventId: string;
  frozenDomainCount: number;
  assignedEntryCount?: number;
  activeDraft?: boolean;
  activePoolVersion?: number | null;
  lastPreservedVersion?: number | null;
  coordinationVersion?: number;
  domainCount?: number;
  allowedActions?: {
    open: boolean; reopen: boolean; close: boolean; enableRead: boolean; revise?: boolean;
    resetToDraft?: boolean; clearDraft?: boolean;
  };
}

export async function getDomains(eventId: string, page = 1, limit = 50) {
  const { data } = await api.get(`/admin/events/${eventId}/domains`, { params: { page, limit } });
  return data.data as { eventId: string; domainConfig: DomainConfig; domains: AdminDomain[]; total: number; page: number; limit: number };
}
export async function getDomainStatus(eventId: string) {
  const { data } = await api.get(`/admin/events/${eventId}/domains/status`);
  return data.data as DomainStatus;
}

type DomainLifecycleResult = DomainConfig & {
  eventId: string;
  publishedBy: string | null;
  readEnabledBy: string | null;
};

export async function openDomainLottery(eventId: string, poolState: string) {
  const { data } = await api.post<{ data: DomainLifecycleResult & { publishedDomainCount: number } }>(
    `/admin/events/${eventId}/domains/open`, {}, { params: { poolState } }
  );
  return data.data;
}

export async function closeDomainLottery(eventId: string, poolState: string) {
  const { data } = await api.post<{ data: DomainLifecycleResult }>(
    `/admin/events/${eventId}/domains/close`, {}, { params: { poolState } }
  );
  return data.data;
}

export async function enableDomainRead(eventId: string, poolState: string) {
  const { data } = await api.post<{ data: DomainLifecycleResult }>(
    `/admin/events/${eventId}/domains/enable-read`, {}, { params: { poolState } }
  );
  return data.data;
}

export async function reviseDomainPool(eventId: string, poolState: string) {
  const { data } = await api.post<{ data: DomainLifecycleResult }>(
    `/admin/events/${eventId}/domains/revise`, {}, { params: { poolState } }
  );
  return data.data;
}

export type DomainRecoveryConfirmation = "RESET_TO_DRAFT" | "CLEAR_DOMAINS";

export async function recoverDomainPool(eventId: string, coordinationVersion: number, confirmation: DomainRecoveryConfirmation, reason: string) {
  const path = confirmation === "RESET_TO_DRAFT" ? "reset-to-draft" : "clear-draft";
  const { data } = await api.post<{ data: DomainStatus & {
    domainConfig: DomainConfig;
    audit: {
      _id: string;
      event: string;
      admin: string;
      action: DomainRecoveryConfirmation;
      reason: string;
      previous: Pick<DomainConfig, "visibility" | "poolVersion" | "publishedAt" | "drawOpenedAt" | "drawClosedAt" | "readEnabledAt">;
      coordinationVersion: number;
      deletedDomainCount: number;
      recordedAt: string;
    };
  } }>(`/admin/events/${eventId}/domains/${path}`, { confirmation, reason }, { params: { coordinationVersion } });
  return data.data;
}

export async function getDomain(eventId: string, domainId: string) {
  const { data } = await api.get(`/admin/events/${eventId}/domains/${domainId}`);
  return data.data as AdminDomain;
}
export async function setDomainsEnabled(eventId: string, enabled: boolean) {
  const { data } = await api.patch(`/admin/events/${eventId}/domains/config`, { enabled });
  return data.data.domainConfig as DomainConfig;
}
export async function createDomain(eventId: string, payload: Pick<AdminDomain, "title" | "problemStatement" | "instructions">) {
  const { data } = await api.post(`/admin/events/${eventId}/domains`, payload);
  return data.data as AdminDomain;
}
export async function updateDomain(eventId: string, domainId: string, payload: Partial<Pick<AdminDomain, "title" | "problemStatement" | "instructions">>) {
  const { data } = await api.patch(`/admin/events/${eventId}/domains/${domainId}`, payload);
  return data.data as AdminDomain;
}
export async function deleteDomain(eventId: string, domainId: string) {
  await api.delete(`/admin/events/${eventId}/domains/${domainId}`);
}
