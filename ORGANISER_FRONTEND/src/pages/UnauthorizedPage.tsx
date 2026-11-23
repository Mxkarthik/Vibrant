import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { useAuth } from "../auth/AuthContext";

export default function UnauthorizedPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const handleReturnToSignIn = async () => {
    setBusy(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-card-icon" style={{ background: "var(--error-bg)", color: "var(--error)" }}>
          <ShieldAlert size={28} />
        </div>

        <h1>Access Restricted</h1>
        <p style={{ color: "var(--error)", fontWeight: 600, marginBottom: "8px" }}>
          Organiser and Admin Access Only
        </p>

        <p>
          {user ? (
            <>
              The signed-in account <strong>({user.email})</strong> is assigned the{" "}
              <strong>{user.role}</strong> role. This portal is strictly for Event Organisers and Administrators.
            </>
          ) : (
            "This account is not authorized to access the Organiser Portal."
          )}
        </p>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void handleReturnToSignIn()}
          disabled={busy}
          style={{ width: "100%", padding: "12px 18px", gap: "8px" }}
        >
          <ArrowLeft size={16} />
          <span>{busy ? "Signing out…" : "Return to Sign In"}</span>
        </button>

        <p className="auth-note">
          If you believe this is an error, contact your VIBRANT2K26 system administrator to update your account role.
        </p>
      </div>
    </main>
  );
}
