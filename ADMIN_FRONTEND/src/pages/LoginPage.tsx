import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ArrowUpRight, Check, LockKeyhole, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { LoadingScreen } from "../auth/RouteGuards";

const apiBase = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000").replace(/\/$/, "");

export default function LoginPage() {
  const { user, loading, authError } = useAuth();
  const [starting, setStarting] = useState(false);
  const location = useLocation();
  const authFailed = new URLSearchParams(location.search).get("error") === "google_auth_failed";
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  if (loading) return <LoadingScreen />;
  if (user?.role === "ADMIN") return <Navigate to={from || "/admin"} replace />;
  if (user) return <Navigate to="/unauthorized" replace />;

  const signIn = () => {
    setStarting(true);
    window.location.assign(`${apiBase}/api/auth/google`);
  };

  return <main className="login-page">
    <section className="login-panel">
      <div className="brand-lockup"><div className="brand-mark">V</div><span>VIBRANT</span></div>
      <div className="login-content">
        <div className="portal-label"><span className="label-line" /> ADMIN PORTAL</div>
        <h1>Welcome back.</h1>
        <p className="login-subtitle">Sign in with your authorized Google account to continue to the VIBRANT administration portal.</p>
        {(authError || authFailed) && <div className="inline-alert" role="alert">{authError || "Google sign-in could not be completed. Please try again or use an authorized account."}</div>}
        <button className="google-button" onClick={signIn} disabled={starting}>
          <GoogleMark /><span>{starting ? "Connecting to Google…" : "Continue with Google"}</span><ArrowUpRight className="button-arrow" size={17} />
        </button>
        <div className="secure-note"><LockKeyhole size={15} /><span>Secure sign-in protected by Google</span></div>
        <div className="access-note"><ShieldCheck size={16} /><span>Administrator access is verified by VIBRANT</span></div>
      </div>
      <footer className="login-footer"><span>© {new Date().getFullYear()} VIBRANT</span><span>Institutional Event Management</span></footer>
    </section>
    <aside className="welcome-panel" aria-label="VIBRANT administration portal">
      <div className="welcome-orb orb-one" /><div className="welcome-orb orb-two" />
      <div className="welcome-content">
        <div className="welcome-kicker"><span className="kicker-dot" /> CAMPUS, CONNECTED</div>
        <h2>Every great campus moment<br />starts with <em>vibrant</em> people.</h2>
        <p>One considered space to coordinate the events, people and experiences that bring your campus to life.</p>
        <div className="welcome-proof"><span className="proof-icon"><Check size={15} /></span><span>Designed for your institution's event team</span></div>
      </div>
      <div className="welcome-footer"><span>ADMINISTRATION · VIBRANT</span><span>01 — 01</span></div>
    </aside>
  </main>;
}

function GoogleMark() {
  return <svg viewBox="0 0 48 48" aria-hidden="true" className="google-mark"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.89c-.58 2.96-2.25 5.48-4.73 7.18l7.64 5.93c4.46-4.13 7.18-10.21 7.18-17.58Z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.89.93 7.58 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.47 0 11.91-2.13 15.88-5.87l-7.64-5.93c-2.12 1.42-4.84 2.26-8.24 2.26-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>;
}
