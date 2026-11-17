import { api } from "./client";

export interface ParticipantDashboard {
  success: true;
  profile: {
    name: string;
    email: string;
    profilePicture: string | null;
  };
  stats: {
    totalRegistrations: number;
    upcomingEvents: number;
    pendingPayments: number;
    completedEvents: number;
  };
  upcomingEvents: Array<{
    registrationId: string;
    eventId: string;
    name: string;
    category: string;
    poster: string | null;
    venue: string;
    startDate: string;
    endDate: string;
    registrationStatus: string;
    registrationType: "INDIVIDUAL" | "TEAM";
    paymentStatus: string;
    teamName?: string;
    teamId?: string;
  }>;
  recentRegistrations: Array<{
    id: string;
    eventId?: string;
    eventName?: string;
    category?: string;
    poster?: string | null;
    venue?: string;
    startDate?: string;
    registeredAt: string;
    registrationType: "INDIVIDUAL" | "TEAM";
    certificateIssued: boolean;
    registrationStatus: string;
    paymentStatus: string;
    teamName?: string;
    teamId?: string;
  }>;
}

export async function getParticipantDashboard() {
  const { data } = await api.get<ParticipantDashboard>("/participant/dashboard");
  return data;
}
