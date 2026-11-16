import { Bell, ChevronRight, LogOut, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { adminNavigation } from "./Sidebar";

interface TopbarProps {
  collapsed: boolean;
  onToggleSidebar: () => void;
  onOpenMobile: () => void;
}

export default function Topbar({ collapsed, onToggleSidebar, onOpenMobile }: TopbarProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const page = adminNavigation.find(item => item.to === location.pathname)
    ?? (location.pathname.startsWith("/admin/events/") ? adminNavigation.find(item => item.to === "/admin/events") : undefined);

  const signOut = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  return <header className="admin-topbar">
    <div className="topbar-leading">
      <button className="icon-button desktop-sidebar-toggle" onClick={onToggleSidebar} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
      </button>
      <button className="icon-button mobile-menu-toggle" onClick={onOpenMobile} aria-label="Open navigation"><Menu size={20} /></button>
      <div className="topbar-breadcrumb"><span>Admin</span><ChevronRight size={14} /><strong>{page?.label ?? "Overview"}</strong></div>
    </div>
    <div className="topbar-actions">
      <button className="icon-button notification-button" aria-label="Notifications (no notifications configured)" title="Notifications"><Bell size={18} /><span className="notification-dot" /></button>
      <div className="topbar-divider" />
      <div className="admin-identity">
        {user?.profilePicture ? <img src={user.profilePicture} className="admin-avatar" alt="" referrerPolicy="no-referrer" /> : <span className="admin-avatar avatar-fallback">{user?.name?.trim().charAt(0).toUpperCase() || "A"}</span>}
        <span className="admin-identity-copy"><strong>{user?.name ?? "Administrator"}</strong><small>Administrator</small></span>
      </div>
      <button className="icon-button logout-button" onClick={() => void signOut()} disabled={loggingOut} aria-label="Sign out" title={loggingOut ? "Signing out…" : "Sign out"}><LogOut size={17} /></button>
    </div>
  </header>;
}
