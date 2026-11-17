import { api } from "./client";

// ─── Status types ─────────────────────────────────────────────────────────────

export type PaymentStatus = "PENDING" | "VERIFIED" | "REJECTED" | "NOT_REQUIRED";
export type PaymentStatusFilter = PaymentStatus | "ALL";

/** All statuses an admin may request via the update endpoints. */
export type PaymentDecision = "PENDING" | "VERIFIED" | "REJECTED";

// ─── Payment history ──────────────────────────────────────────────────────────

export interface PaymentHistoryEntry {
  fromStatus: PaymentStatus;
  toStatus: PaymentStatus;
  /** ObjectId string or populated user object depending on select projection. */
  changedBy: string | { _id?: string; name?: string; email?: string } | null;
  changedAt: string;
  reason: string | null;
}

// ─── List params ─────────────────────────────────────────────────────────────

export interface PaymentListParams {
  page: number;
  limit: number;
  search: string;
  status: PaymentStatusFilter;
}

// ─── Payment subdocument (embedded in Registration / Team) ────────────────────

export interface PaymentSubdoc {
  method?: string;
  status?: PaymentStatus;
  proofUrl?: string | null;
  verifiedAt?: string | null;
  history?: PaymentHistoryEntry[];
}

// ─── Individual payment record (returned by GET /admin/payments/individual) ───

export interface IndividualPaymentRecord {
  _id: string;
  participantDetails?: {
    fullName?: string;
    mobileNumber?: string;
    collegeName?: string;
    department?: string;
  };
  user?: { name?: string; email?: string } | null;
  event?: { name?: string; category?: string; startDate?: string } | null;
  payment?: PaymentSubdoc;
  createdAt?: string;
}

// ─── Team payment record (returned by GET /admin/payments/teams) ──────────────

export interface TeamPaymentRecord {
  _id: string;
  teamName?: string;
  memberCount?: number;
  status?: string;
  leader?: { name?: string; email?: string } | null;
  event?: { name?: string; category?: string; startDate?: string } | null;
  payment?: PaymentSubdoc;
  createdAt?: string;
}

// ─── Paginated list result ────────────────────────────────────────────────────

export interface PaymentQueueResult<T> {
  success: true;
  payments: T[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

// ─── Update request / response ────────────────────────────────────────────────

export interface PaymentUpdatePayload {
  status: PaymentDecision;
  reason?: string;
}

export interface PaymentUpdateResult {
  success: true;
  message: string;
  registration?: {
    id: string;
    status: string;
    payment: {
      method: string;
      status: PaymentStatus;
      verifiedAt?: string | null;
    };
  };
  team?: {
    id: string;
    teamName: string;
    memberCount: number;
    status: string;
    payment: {
      method: string;
      status: PaymentStatus;
      verifiedAt?: string | null;
    };
  };
}

// ─── API functions ────────────────────────────────────────────────────────────

export async function getIndividualPayments(params: PaymentListParams) {
  const { data } = await api.get<PaymentQueueResult<IndividualPaymentRecord>>(
    "/admin/payments/individual",
    { params }
  );
  return data;
}

export async function getTeamPayments(params: PaymentListParams) {
  const { data } = await api.get<PaymentQueueResult<TeamPaymentRecord>>(
    "/admin/payments/teams",
    { params }
  );
  return data;
}

/**
 * Update an individual registration's payment status.
 * A reason is required by the backend when status === "REJECTED".
 */
export async function updateIndividualPayment(
  id: string,
  payload: PaymentUpdatePayload
): Promise<PaymentUpdateResult> {
  const { data } = await api.patch<PaymentUpdateResult>(
    `/registrations/${id}/payment`,
    payload
  );
  return data;
}

/**
 * Update a team's payment status.
 * A reason is required by the backend when status === "REJECTED".
 */
export async function updateTeamPayment(
  id: string,
  payload: PaymentUpdatePayload
): Promise<PaymentUpdateResult> {
  const { data } = await api.patch<PaymentUpdateResult>(
    `/teams/${id}/payment`,
    payload
  );
  return data;
}
