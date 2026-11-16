import { useState } from "react";
import { KeyRound, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import PageHeader from "../../components/admin/PageHeader";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";

export default function AccountSettingsPage() {
  const { user, refreshUser } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verifySession = async () => {
    setRefreshing(true);
    setMessage(null);
    setError(null);
    try {
      const current = await refreshUser();
      if (!current) throw new Error("Your session could not be verified. Sign in again if it has expired.");
      setMessage("Your account details and session are up to date.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your session could not be verified.");
    } finally {
      setRefreshing(false);
    }
  };

  return <>
    <PageHeader title="Settings" description="Review your administrator account and sign-in session." action={<Button variant="secondary" icon={<RefreshCw size={15} className={refreshing ? "is-spinning" : ""} />} onClick={() => void verifySession()} disabled={refreshing}>{refreshing ? "Checking…" : "Refresh account"}</Button>} />
    {message && <p className="settings-feedback success" role="status">{message}</p>}
    {error && <p className="settings-feedback error" role="alert">{error}</p>}
    <div className="settings-grid">
      <Card className="settings-card account-settings-card">
        <div className="settings-card-heading"><span><UserRound size={17} /></span><div><h2>Administrator account</h2><p>Identity used for this VIBRANT Admin session.</p></div></div>
        <div className="settings-profile">
          {user?.profilePicture ? <img src={user.profilePicture} alt="" referrerPolicy="no-referrer" /> : <span>{user?.name?.trim().charAt(0).toUpperCase() || "A"}</span>}
          <div><strong>{user?.name || "Administrator"}</strong><small>{user?.email || "Email unavailable"}</small></div>
        </div>
        <dl className="settings-details"><div><dt>Platform role</dt><dd>{user?.role || "ADMIN"}</dd></div><div><dt>Account identity</dt><dd>{user?.email || "—"}</dd></div></dl>
      </Card>
      <Card className="settings-card security-settings-card">
        <div className="settings-card-heading"><span><ShieldCheck size={17} /></span><div><h2>Sign-in and session</h2><p>Authentication is managed by your VIBRANT session.</p></div></div>
        <div className="settings-security-row"><KeyRound size={17} /><div><strong>Google sign-in</strong><small>Use the Google account associated with this administrator profile.</small></div></div>
        <div className="settings-security-note">Your session is validated by the backend. Sign out from the profile control in the top bar to end it.</div>
      </Card>
    </div>
  </>;
}
