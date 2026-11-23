import { api } from "./client";
import { notifyRegistrationChanged } from "./registrationStateEvents";

export interface IndividualRegistrationRequest {
  participantDetails: {
    fullName: string;
    mobileNumber: string;
    collegeName: string;
    department: string;
    yearOfStudy: string;
    section: string;
    rollNumber: string;
  };
  customResponses: Array<{ fieldKey: string; value: string | number | string[] }>;
  paymentMethod?: "UPI" | "CASH";
  cashReceiverName?: string;
}

export interface RegistrationReceipt {
  id: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
}

export interface RegistrationRecordView {
  id: string;
  status: string;
  createdAt: string;
  participantDetails: IndividualRegistrationRequest["participantDetails"];
  paymentStatus: string;
  paymentMethod: string;
  paymentProofUrl: string | null;
  cashReceiverName: string | null;
  amount: number | null;
  event: { id: string; name: string; category: string; venue: string; startDate: string; endDate: string; status: string; paymentQrUrl?: string | null; registrationFee?: number } | null;
}

export interface MyRegistration {
  id: string;
  createdAt: string;
  status: string;
  participantName: string | null;
  certificate: { isIssued: boolean; certificateId: string | null; issuedAt: string | null };
  attendance: { isPresent: boolean; checkedInAt: string | null };
  isTeam: boolean;
  isTeamLeader: boolean;
  teamId: string | null;
  teamStatus: string | null;
  team: { name: string; memberCount: number; paymentStatus: string } | null;
  payment: { method: string; status: string };
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
  } | null;
}

export interface TicketAccess {
  type: "SINGLE_EVENT" | "MULTI_EVENT";
  eligibleEventIds: string[];
  grantedAt?: string | null;
}

export interface EntitledEventMeta {
  _id: string;
  name?: string;
  venue?: string;
  startDate?: string;
  endDate?: string;
  category?: string;
}

const eventMetaCache = new Map<string, EntitledEventMeta>();

export async function resolveEntitledEventMetadata(eventIds: string[], signal?: AbortSignal): Promise<Map<string, EntitledEventMeta>> {
  const result = new Map<string, EntitledEventMeta>();
  const toFetch: string[] = [];

  for (const id of eventIds) {
    if (!id) continue;
    if (eventMetaCache.has(id)) {
      result.set(id, eventMetaCache.get(id)!);
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length === 0) return result;

  const settled = await Promise.allSettled(
    toFetch.map((id) => api.get<{ success: boolean; event: EntitledEventMeta }>(`/events/${encodeURIComponent(id)}`, { signal }))
  );

  settled.forEach((res, index) => {
    const id = toFetch[index];
    if (res.status === "fulfilled" && res.value?.data?.event) {
      const evt = res.value.data.event;
      const meta: EntitledEventMeta = {
        _id: evt._id || id,
        name: evt.name,
        venue: evt.venue,
        startDate: evt.startDate,
        endDate: evt.endDate,
        category: evt.category,
      };
      eventMetaCache.set(id, meta);
      result.set(id, meta);
    } else {
      const meta: EntitledEventMeta = { _id: id };
      result.set(id, meta);
    }
  });

  return result;
}

export interface DigitalTicket {
  registrationId: string;
  registrationType: "INDIVIDUAL" | "TEAM";
  attendeeName: string;
  teamName?: string;
  isTeamLeader?: boolean;
  qrToken: string;
  registrationStatus: string;
  paymentStatus: string;
  ticketStatus: "VALID" | "HISTORICAL";
  event: {
    name: string;
    category: string;
    venue: string;
    startDate: string;
    endDate: string;
    status: string;
  };
  access?: TicketAccess;
  entitledEvents?: EntitledEventMeta[];
}

export async function getMyRegistrations(signal?: AbortSignal): Promise<MyRegistration[]> {
  const { data } = await api.get<{ success: true; count: number; registrations: MyRegistration[] }>("/registrations/my", { signal });
  return data.registrations;
}

export async function getIndividualTicket(registrationId: string, signal?: AbortSignal): Promise<DigitalTicket> {
  const { data } = await api.get<{ success: true; ticket: DigitalTicket }>(`/registrations/${encodeURIComponent(registrationId)}/ticket`, { signal });
  return data.ticket;
}

export async function getCertificatePdf(certificateId: string): Promise<Blob> {
  const { data } = await api.get<Blob>(`/registrations/certificate/${encodeURIComponent(certificateId)}/download`, { responseType: "blob" });
  return data;
}

export async function createIndividualRegistration(eventId: string, request: IndividualRegistrationRequest, paymentProof?: File, onProgress?: (percent: number) => void): Promise<RegistrationReceipt> {
  const body = new FormData();
  body.append("participantDetails", JSON.stringify(request.participantDetails));
  body.append("customResponses", JSON.stringify(request.customResponses));
  if (request.paymentMethod) body.append("paymentMethod", request.paymentMethod);
  if (request.cashReceiverName) body.append("cashReceiverName", request.cashReceiverName);
  if (paymentProof) body.append("screenshot", paymentProof);
  const { data } = await api.post<{
    success: true;
    registration: {
      _id: string;
      status: string;
      payment?: { status?: string; method?: string };
    };
  }>(`/events/${encodeURIComponent(eventId)}/register`, body, {
    onUploadProgress: progress => { if (progress.total) onProgress?.(Math.round(progress.loaded / progress.total * 100)); },
  });
  notifyRegistrationChanged();

  // Keep the response in the UI to the receipt fields only; never expose the QR token.
  return {
    id: data.registration._id,
    status: data.registration.status,
    paymentStatus: data.registration.payment?.status || "NOT_REQUIRED",
    paymentMethod: data.registration.payment?.method || "NONE",
  };
}

export async function getRegistrationRecord(registrationId: string, signal?: AbortSignal): Promise<RegistrationRecordView> {
  const { data } = await api.get<{
    success: true;
    registration: {
      _id: string;
      status: string;
      createdAt: string;
      participantDetails: RegistrationRecordView["participantDetails"];
      payment?: { status?: string; method?: string; proofUrl?: string | null; cashReceiverName?: string | null };
    event?: { _id: string; name: string; category: string; venue: string; startDate: string; endDate: string; status: string; paymentQrUrl?: string | null; registration?: { registrationFee?: number } } | null;
    };
  }>(`/registrations/${encodeURIComponent(registrationId)}`, { signal });
  const record = data.registration;
  return {
    id: record._id,
    status: record.status,
    createdAt: record.createdAt,
    participantDetails: record.participantDetails,
    paymentStatus: record.payment?.status || "NOT_REQUIRED",
    paymentMethod: record.payment?.method || "NONE",
    paymentProofUrl: record.payment?.proofUrl || null,
    cashReceiverName: record.payment?.cashReceiverName || null,
    amount: typeof record.event?.registration?.registrationFee === "number" ? record.event.registration.registrationFee : null,
    event: record.event ? {
      id: record.event._id,
      name: record.event.name,
      category: record.event.category,
      venue: record.event.venue,
      startDate: record.event.startDate,
      endDate: record.event.endDate,
      status: record.event.status,
      paymentQrUrl: record.event.paymentQrUrl || null,
      registrationFee: record.event.registration?.registrationFee,
    } : null,
  };
}

export async function uploadIndividualPaymentProof(registrationId: string, file: File, onProgress?: (percent: number) => void) {
  const formData = new FormData();
  formData.append("screenshot", file);
  const { data } = await api.post<{ success: true; message: string; proofUrl: string }>(`/registrations/${encodeURIComponent(registrationId)}/payment-proof`, formData, {
    onUploadProgress: (event) => { if (event.total) onProgress?.(Math.round((event.loaded / event.total) * 100)); },
  });
  return data;
}
