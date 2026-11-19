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
  eventId?: string;
}

// ─── Payment subdocument (embedded in Registration / Team) ────────────────────

export interface PaymentSubdoc {
  method?: string;
  status?: PaymentStatus;
  proofUrl?: string | null;
  cashReceiverName?: string | null;
  expectedAmount?: number | null;
  receivedAmount?: number | null;
  currency?: string | null;
  verifiedBy?: string | { _id?: string; name?: string; email?: string } | null;
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
  event?: {
    name?: string;
    category?: string;
    startDate?: string;
    registration?: { registrationFee?: number };
    registrationFee?: number;
  } | null;
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
  event?: {
    name?: string;
    category?: string;
    startDate?: string;
    registration?: { registrationFee?: number };
    registrationFee?: number;
  } | null;
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
  receivedAmount?: number;
}

// ─── Financial summary & analytics interfaces ─────────────────────────────────

export interface FinancialSummaryData {
  totalVerifiedAmount: number;
  cashVerifiedAmount: number;
  upiVerifiedAmount: number;
  otherVerifiedAmount: number;
  pendingExpectedAmount: number;
  rejectedExpectedAmount: number;
  verifiedCount: number;
  pendingCount: number;
  rejectedCount: number;
  individualCount: number;
  teamCount: number;
  /** Count-based collection rate: verifiedParticipants / totalPaidParticipants × 100 */
  collectionPercentage: number | null;
  /** Number of paid participants whose payment is VERIFIED */
  verifiedParticipants: number;
  /** Number of paid participants whose payment is PENDING */
  pendingParticipants: number;
  /** Number of paid participants whose payment is REJECTED */
  rejectedParticipants: number;
  /** Total paid participants = verified + pending + rejected (excludes NOT_REQUIRED) */
  totalPaidParticipants: number;
  unknownAmountCount: number;
  isComplete: boolean;
  currency: string;
  calculatedAt: string;
}

export interface PaymentMethodBreakdown {
  method: string;
  amount: number;
  count: number;
  percentage: number;
}

export interface CashReceiverSummary {
  receiverName: string;
  isUnrecorded: boolean;
  verifiedAmount: number;
  pendingAmount: number;
  verifiedCount: number;
  pendingCount: number;
  unknownAmountCount: number;
  events?: Array<{
    eventId: string;
    eventName: string;
    verifiedAmount: number;
    verifiedCount: number;
  }>;
}

export interface EventFinancialBreakdown {
  eventId: string;
  eventName: string;
  category?: string;
  verifiedAmount: number;
  cashAmount: number;
  upiAmount: number;
  pendingAmount: number;
  rejectedAmount: number;
  verifiedCount: number;
  pendingCount: number;
  rejectedCount: number;
  unknownAmountCount: number;
  verifiedParticipants: number;
  pendingParticipants: number;
  rejectedParticipants: number;
  totalPaidParticipants: number;
  collectionPercentage: number | null;
}

export interface FinancialAnalyticsResponse {
  success: boolean;
  summary: FinancialSummaryData;
  methodBreakdown: PaymentMethodBreakdown[];
  cashReceivers: CashReceiverSummary[];
  eventBreakdown: EventFinancialBreakdown[];
  event?: {
    _id: string;
    name: string;
    category: string;
    startDate?: string;
    registrationFee?: number;
  } | null;
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

/**
 * Fetch aggregated financial summary and analytics
 */
export async function getFinancialSummary(params?: { eventId?: string }) {
  const { data } = await api.get<FinancialAnalyticsResponse>(
    "/admin/payments/summary",
    { params }
  );
  return data;
}
