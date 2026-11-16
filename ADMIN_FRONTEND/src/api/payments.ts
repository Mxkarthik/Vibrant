import { api } from "./client";

export type PaymentStatus = "PENDING" | "VERIFIED" | "REJECTED" | "NOT_REQUIRED";
export type PaymentStatusFilter = PaymentStatus | "ALL";
export type PaymentDecision = "VERIFIED" | "REJECTED";

export interface PaymentListParams {
  page: number;
  limit: number;
  search: string;
  status: PaymentStatusFilter;
}

export interface PaymentEventSummary {
  name?: string;
  category?: string;
  startDate?: string;
}

export interface IndividualPaymentRecord {
  _id: string;
  participantDetails?: { fullName?: string; mobileNumber?: string; collegeName?: string; department?: string };
  user?: { name?: string; email?: string } | null;
  event?: PaymentEventSummary | null;
  payment?: { method?: string; status?: PaymentStatus; proofUrl?: string | null; verifiedAt?: string | null };
  createdAt?: string;
}

export interface TeamPaymentRecord {
  _id: string;
  teamName?: string;
  memberCount?: number;
  status?: string;
  leader?: { name?: string; email?: string } | null;
  event?: PaymentEventSummary | null;
  payment?: { method?: string; status?: PaymentStatus; proofUrl?: string | null; verifiedAt?: string | null };
  createdAt?: string;
}

export interface PaymentQueueResult<T> {
  success: true;
  payments: T[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

export async function getIndividualPayments(params: PaymentListParams) {
  const { data } = await api.get<PaymentQueueResult<IndividualPaymentRecord>>("/admin/payments/individual", { params });
  return data;
}

export async function getTeamPayments(params: PaymentListParams) {
  const { data } = await api.get<PaymentQueueResult<TeamPaymentRecord>>("/admin/payments/teams", { params });
  return data;
}

export async function updateIndividualPayment(id: string, status: PaymentDecision) {
  const { data } = await api.patch<{ success: true; message: string }>(`/registrations/${id}/payment`, { status });
  return data;
}

export async function updateTeamPayment(id: string, status: PaymentDecision) {
  const { data } = await api.patch<{ success: true; message: string }>(`/teams/${id}/payment`, { status });
  return data;
}
