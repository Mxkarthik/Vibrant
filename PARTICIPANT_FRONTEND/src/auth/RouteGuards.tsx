import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { isParticipantPortalRole, useAuth } from "./AuthContext";

export function ParticipantLoadingScreen() {
  return <main className="participant-status-screen" aria-live="polite"><span className="participant-loading-bar" /><p>Restoring your participant session</p></main>;
}

export function RequireParticipant() {
  const { user, loading, error, refreshUser } = useAuth();
  const location = useLocation();
  if (loading) return <ParticipantLoadingScreen />;
  if (error) return <main className="participant-status-screen"><h1>Session check failed</h1><p>{error}</p><button className="participant-button" onClick={() => void refreshUser()}>Try again</button></main>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!isParticipantPortalRole(user.role)) return <ParticipantAccessDenied role={String(user.role)} />;
  return <Outlet />;
}

export function ParticipantLoginRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <ParticipantLoadingScreen />;
  if (user && isParticipantPortalRole(user.role)) return <Navigate to="/dashboard" replace />;
  if (user) return <ParticipantAccessDenied role={String(user.role)} />;
  return children;
}

export function ParticipantAccessDenied({ role }: { role: string }) {
  return <main className="participant-status-screen"><div className="participant-status-mark">V</div><p className="participant-eyebrow">VIBRANT PORTAL ACCESS</p><h1>This account cannot access the Participant Portal.</h1><p>The signed-in account role ({role || "unknown"}) is not supported here. Sign in with a PARTICIPANT, ORGANISER, or ADMIN account.</p><a className="participant-button" href="/">Return to VIBRANT</a></main>;
}

export function ParticipantNotFound() {
  return <main className="participant-status-screen"><p className="participant-eyebrow">VIBRANT2K26</p><h1>Page not found</h1><p>This page is not part of the Participant Portal.</p><a className="participant-button" href="/">Return home</a></main>;
}
