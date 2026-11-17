import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";

const navItems = [
  ["Dashboard", "/dashboard", "◫"],
  ["Explore Events", "/events", "✳"],
  ["My Registrations", "/my-registrations", "▤"],
  ["My Attendance", "/my-attendance", "✓"],
  ["My Certificates", "/my-certificates", "◇"],
  ["My Profile", "/profile", "◉"],
] as const;

export default function ParticipantLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
      navigate("/", { replace: true });
    } catch {
      setLogoutError("We couldn't end your session. Please try again.");
    } finally {
      setLoggingOut(false);
    }
  };

  const initials = user?.name?.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "V";

  return <div className="participant-app-shell">
    <aside className={`participant-sidebar${menuOpen ? " is-open" : ""}`}>
      <a className="participant-app-brand" href="/dashboard"><span>VIBRANT<span>2K26</span></span><small>PARTICIPANT PORTAL</small></a>
      <div className="participant-nav-label">YOUR SPACE</div>
      <nav className="participant-app-nav" aria-label="Participant navigation">
        {navItems.map(([label, path, icon]) => <NavLink key={path} to={path} end={path === "/dashboard"} onClick={() => setMenuOpen(false)} className={({ isActive }) => `participant-nav-link${isActive ? " is-active" : ""}`}><span className="participant-nav-icon" aria-hidden="true">{icon}</span>{label}</NavLink>)}
      </nav>
      <div className="participant-sidebar-bottom">
        {logoutError && <p className="participant-logout-error" role="alert">{logoutError}</p>}
        <button className="participant-logout" onClick={() => void handleLogout()} disabled={loggingOut}><span aria-hidden="true">↪</span>{loggingOut ? "Signing out…" : "Sign out"}</button>
        <div className="participant-mini-profile">
          {user?.profilePicture ? <img src={user.profilePicture} alt="" referrerPolicy="no-referrer" /> : <span>{initials}</span>}
          <div><strong>{user?.name}</strong><small>PARTICIPANT</small></div>
        </div>
      </div>
    </aside>

    <div className="participant-main-column">
      <header className="participant-topbar">
        <button className="participant-menu-toggle" type="button" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><span /><span /></button>
        <span className="participant-topbar-label">DADI INSTITUTE OF ENGINEERING &amp; TECHNOLOGY · ANAKAPALLE</span>
        <div className="participant-topbar-user">{user?.profilePicture ? <img src={user.profilePicture} alt="" referrerPolicy="no-referrer" /> : <span>{initials}</span>}<div><strong>{user?.name}</strong><small>PARTICIPANT</small></div></div>
      </header>
      <main className="participant-content"><Outlet /></main>
    </div>
    {menuOpen && <button className="participant-sidebar-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
  </div>;
}
