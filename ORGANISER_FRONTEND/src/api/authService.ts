import { api, API_BASE_URL } from "./client.ts";

export type UserRole = "ADMIN" | "ORGANISER" | "PARTICIPANT";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  profilePicture: string | null;
  role: UserRole;
}

export async function fetchCurrentUser(): Promise<CurrentUser> {
  const { data } = await api.get<{ success: true; user: CurrentUser }>("/auth/me");
  return data.user;
}

export async function logoutUser(): Promise<void> {
  await api.post("/auth/logout");
}

export function getGoogleAuthUrl(): string {
  return `${API_BASE_URL}/auth/google/organiser`;
}
