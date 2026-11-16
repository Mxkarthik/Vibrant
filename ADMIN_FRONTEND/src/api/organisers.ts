import { api } from "./client";

export interface AdminUserRecord {
  _id: string;
  name: string;
  email: string;
  profilePicture?: string | null;
  role: "ADMIN" | "PARTICIPANT" | "ORGANISER";
  isActive: boolean;
  createdAt?: string;
}

export interface OrganisersResult {
  success: true;
  count: number;
  organisers: AdminUserRecord[];
}

export interface AdminUsersResult {
  success: true;
  users: AdminUserRecord[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

export async function getOrganisers() {
  const { data } = await api.get<OrganisersResult>("/admin/organisers");
  return data;
}

export async function getEligibleParticipants(search: string, page: number, limit = 10) {
  const { data } = await api.get<AdminUsersResult>("/admin/users", { params: { role: "PARTICIPANT", search, page, limit } });
  return data;
}

export async function updateOrganiserRole(email: string, role: "ORGANISER" | "PARTICIPANT") {
  const { data } = await api.patch<{ success: true; message: string; user: { _id?: string; name: string; email: string; role: "ORGANISER" | "PARTICIPANT" } }>("/admin/users/role", { email, role });
  return data;
}
