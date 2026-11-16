import { api } from "./client";

export interface AdminDashboardData {
  success: true;
  overview: {
    totalEvents: number;
    publishedEvents: number;
    completedEvents: number;
    cancelledEvents: number;
    totalRegistrations: number;
    totalOrganisers: number;
  };
  payments: {
    pendingIndividual: number;
    pendingTeams: number;
    verifiedIndividual: number;
    verifiedTeams: number;
  };
  attendance: {
    totalCheckedIn: number;
    totalRegistered: number;
    attendancePercentage: number;
  };
  recentEvents: Array<{
    name: string;
    category: string;
    startDate: string;
    venue: string;
    status: "PUBLISHED" | "COMPLETED" | "CANCELLED";
    createdAt: string;
  }>;
}

export async function getAdminDashboard() {
  const { data } = await api.get<AdminDashboardData>("/admin/dashboard");
  return data;
}
