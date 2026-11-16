import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import axios from "axios";
import { api } from "../api/client";

export type UserRole = "ADMIN" | "PARTICIPANT" | "ORGANISER";
export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  profilePicture: string | null;
  role: UserRole;
}
interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  refreshUser: () => Promise<CurrentUser | null>;
  clearUser: () => void;
  logout: () => Promise<void>;
  authError: string | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
function errorMessage(error: unknown) {
  return axios.isAxiosError(error) ? error.response?.data?.message ?? "Unable to verify your session." : "Unable to verify your session.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    setLoading(true);
    setAuthError(null);
    try {
      const { data } = await api.get<{ success: true; user: CurrentUser }>("/auth/me");
      setUser(data.user);
      return data.user;
    } catch (error) {
      setUser(null);
      if (!axios.isAxiosError(error) || error.response?.status !== 401) setAuthError(errorMessage(error));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearUser = useCallback(() => { setUser(null); setAuthError(null); }, []);
  const logout = useCallback(async () => {
    await api.post("/auth/logout");
    setUser(null);
    setAuthError(null);
  }, []);
  useEffect(() => { void refreshUser(); }, [refreshUser]);
  const value = useMemo(() => ({ user, loading, refreshUser, clearUser, logout, authError }), [user, loading, refreshUser, clearUser, logout, authError]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
