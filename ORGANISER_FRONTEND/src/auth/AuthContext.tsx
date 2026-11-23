import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchCurrentUser, logoutUser, type CurrentUser } from "../api/authService";
import { getApiErrorMessage } from "../api/client";

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  refreshUser: () => Promise<CurrentUser | null>;
  logout: () => Promise<void>;
  authError: string | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const refreshUser = useCallback(async (): Promise<CurrentUser | null> => {
    setLoading(true);
    setAuthError(null);
    try {
      const currentUser = await fetchCurrentUser();
      setUser(currentUser);
      return currentUser;
    } catch (error) {
      setUser(null);
      // Only set error message if it's not a standard 401 unauthenticated response
      setAuthError(getApiErrorMessage(error, "Unable to verify session."));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await logoutUser();
    } finally {
      setUser(null);
      setAuthError(null);
      // Purge query cache completely on logout to eliminate cross-session leakage
      queryClient.clear();
    }
  }, [queryClient]);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const value = useMemo(
    () => ({ user, loading, refreshUser, logout, authError }),
    [user, loading, refreshUser, logout, authError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
