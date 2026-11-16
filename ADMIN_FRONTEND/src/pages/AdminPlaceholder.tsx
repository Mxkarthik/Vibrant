import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function AdminPlaceholder() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const signOut = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };
  return <main className="full-screen"><section className="status-card admin-placeholder">
    <div className="brand-mark small-mark">V</div><p className="eyebrow">VIBRANT ADMIN PORTAL</p>
    <h1>Authentication complete</h1>
    <p className="muted">Signed in as <strong>{user?.name}</strong> ({user?.email}). The protected admin area is ready for the next phase.</p>
    <button className="button button-secondary" onClick={() => void signOut()} disabled={loggingOut}>{loggingOut ? "Signing out…" : "Sign out"}</button>
  </section></main>;
}
