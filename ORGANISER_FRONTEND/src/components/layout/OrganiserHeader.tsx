import { Link, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { clearActiveEventId } from "../../utils/activeEventStorage";

export default function OrganiserHeader() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    clearActiveEventId();
    await logout();
    navigate("/login", { replace: true });
  };

  const userInitial = user?.name ? user.name.trim().charAt(0).toUpperCase() : "V";

  return (
    <header className="organiser-header" role="banner">
      <div className="container header-container">
        {/* Left: Brand Badge */}
        <Link to="/events" className="header-brand-link" aria-label="VIBRANT2K26 Organiser Portal">
          <div className="header-brand-icon" aria-hidden="true">
            V
          </div>
          <div className="header-brand-text">
            <span className="header-brand-title">VIBRANT2K26</span>
            <span className="header-brand-subtext">Organiser Portal</span>
          </div>
        </Link>

        {/* Right: User Avatar & Sign Out */}
        <div className="header-user-section">
          <div className="header-user-info" title={`${user?.name || "Organiser"} (${user?.role || "ORGANISER"})`}>
            <span className="header-user-name">{user?.name || "Organiser"}</span>
            <span className="header-user-role">{user?.role || "ORGANISER"}</span>
          </div>

          <div className="header-user-avatar" aria-label={`Logged in as ${user?.name || "User"}`}>
            {userInitial}
          </div>

          <button
            type="button"
            className="btn-header-logout"
            onClick={() => void handleLogout()}
            aria-label="Sign out"
            title="Sign out of Organiser Portal"
          >
            <LogOut size={14} />
            <span className="logout-text">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
