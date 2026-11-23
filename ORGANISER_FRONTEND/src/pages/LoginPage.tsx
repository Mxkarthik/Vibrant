import { useSearchParams } from "react-router-dom";
import { ShieldCheck, AlertCircle } from "lucide-react";
import { getGoogleAuthUrl } from "../api/authService";

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const errorParam = searchParams.get("error");

  const handleGoogleSignIn = () => {
    window.location.href = getGoogleAuthUrl();
  };

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-card-icon">
          <ShieldCheck size={28} />
        </div>

        <h1>VIBRANT2K26</h1>
        <p style={{ fontWeight: 600, color: "var(--navy)", marginBottom: "4px" }}>
          Organiser Portal
        </p>
        <p>
          Sign in with your authorized Google account to manage event check-ins and attendance.
        </p>

        {errorParam && (
          <div
            style={{
              padding: "10px 14px",
              background: "var(--error-bg)",
              border: "1px solid #fca5a5",
              borderRadius: "var(--radius-sm)",
              color: "var(--error)",
              fontSize: "12px",
              marginBottom: "20px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              textAlign: "left",
            }}
            role="alert"
          >
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>Google authentication failed. Please check your credentials and try again.</span>
          </div>
        )}

        <button
          type="button"
          className="btn-google"
          onClick={handleGoogleSignIn}
          aria-label="Sign in with Google"
        >
          <svg className="google-icon" width="18" height="18" viewBox="0 0 18 18">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.616z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"
            />
          </svg>
          <span>Continue with Google</span>
        </button>

        <p className="auth-note">
          Access is strictly reserved for authorized VIBRANT Event Organisers and Administrators.
        </p>
      </div>
    </main>
  );
}
