import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthContext";

export function LoadingScreen() {
  return <main className="full-screen" aria-live="polite"><div className="loading-card"><span className="spinner" /><p>Restoring your secure session</p></div></main>;
}

export function PublicOnlyRoute() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user?.role === "ADMIN") return <Navigate to="/admin" replace />;
  return <Outlet />;
}

export function RequireAdmin() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (user.role !== "ADMIN") return <Navigate to="/unauthorized" replace />;
  return <Outlet />;
}

export function UnauthorizedPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const returnToSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      // A non-admin session is still valid on the server. Clear its HTTP-only
      // cookie before allowing another Google sign-in attempt.
      await logout();
      navigate("/login", { replace: true });
    } catch {
      // Keep the in-memory session intact if the server did not confirm logout.
      setError("We couldn't end this session. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return <main className="full-screen"><section className="status-card">
    <div className="status-icon"><ShieldAlert size={24} /></div>
    <p className="eyebrow">ACCESS RESTRICTED</p>
    <h1>This portal is for administrators</h1>
    <p className="muted">{user ? `The signed-in account (${user.email}) has the ${user.role} role.` : "This account is not authorized."} Ask a VIBRANT administrator to review your account access.</p>
    {error && <p className="inline-alert" role="alert">{error}</p>}
    <button className="button button-secondary" onClick={() => void returnToSignIn()} disabled={busy}>{busy ? "Ending session…" : "Return to Sign In"}</button>
  </section></main>;
}

export function NotFoundPage() {
  return <main className="full-screen"><section className="status-card">
    <div className="status-icon"><ShieldCheck size={24} /></div><p className="eyebrow">VIBRANT ADMIN</p>
    <h1>Page not found</h1><p className="muted">The page you requested does not exist.</p>
    <a className="button button-secondary" href="/">Back to sign in</a>
  </section></main>;
}
