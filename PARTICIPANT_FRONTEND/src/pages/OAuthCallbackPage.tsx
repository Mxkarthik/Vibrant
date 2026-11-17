import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { isParticipantPortalRole, useAuth } from "../auth/AuthContext";
import { ParticipantAccessDenied, ParticipantLoadingScreen } from "../auth/RouteGuards";

export default function OAuthCallbackPage() {
  const { user, loading, error } = useAuth();
  const navigate = useNavigate();
  const [googleFailed] = useState(() => new URLSearchParams(window.location.search).get("error") === "google_auth_failed");

  useEffect(() => {
    if (loading || googleFailed || error || !user) return;
    if (isParticipantPortalRole(user.role)) navigate("/dashboard", { replace: true });
  }, [error, googleFailed, loading, navigate, user]);

  if (googleFailed) return <main className="participant-status-screen"><p className="participant-eyebrow">GOOGLE SIGN-IN</p><h1>Sign-in needs another try.</h1><p>Google sign-in could not be completed. Please return and try again.</p><a className="participant-button" href="/login">Return to sign in</a></main>;
  if (loading) return <ParticipantLoadingScreen />;
  if (error) return <main className="participant-status-screen"><p className="participant-eyebrow">SESSION CHECK</p><h1>We couldn't confirm your account.</h1><p>{error}</p><a className="participant-button" href="/login">Return to sign in</a></main>;
  if (user && !isParticipantPortalRole(user.role)) return <ParticipantAccessDenied role={String(user.role)} />;
  if (!user) return <main className="participant-status-screen"><p className="participant-eyebrow">SESSION CHECK</p><h1>Sign in to continue.</h1><p>We could not find an active VIBRANT session.</p><a className="participant-button" href="/login">Continue with Google</a></main>;
  return <ParticipantLoadingScreen />;
}
