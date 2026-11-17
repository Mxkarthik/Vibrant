import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import axios from "axios";
import { api, clearStoredToken } from "../api/client";

export type ParticipantRole = "PARTICIPANT" | "ADMIN" | "ORGANISER";
export function isParticipantPortalRole(role: unknown): role is ParticipantRole {
  return role === "PARTICIPANT" || role === "ORGANISER" || role === "ADMIN";
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  profilePicture: string | null;
  role: ParticipantRole;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  error: string | null;
  refreshUser: () => Promise<CurrentUser | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ success: true; user: CurrentUser }>("/auth/me");
      setUser(data.user);
      return data.user;
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        clearStoredToken();
        setUser(null);
      } else {
        setError("We couldn't verify your session. Check your connection and try again.");
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    clearStoredToken();
    try {
      await api.post("/auth/logout");
    } catch {
      // Swallowed on logout so local state is cleared reliably
    }
    setUser(null);
    setError(null);
  }, []);

  useEffect(() => { void refreshUser(); }, [refreshUser]);
  const value = useMemo(() => ({ user, loading, error, refreshUser, logout }), [user, loading, error, refreshUser, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
