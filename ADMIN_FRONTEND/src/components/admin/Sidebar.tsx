import { CalendarDays, ChartNoAxesColumn, ClipboardCheck, CreditCard, FileBadge, Settings2, Users, UserRoundCog, X } from "lucide-react";
import NavigationItem, { type AdminNavigationItem } from "./NavigationItem";
import type { RefObject } from "react";
import { Link } from "react-router-dom";

export const adminNavigation: AdminNavigationItem[] = [
  { label: "Overview", to: "/admin", icon: ChartNoAxesColumn },
  { label: "Events", to: "/admin/events", icon: CalendarDays },
  { label: "Participants", to: "/admin/participants", icon: Users },
  { label: "Payments", to: "/admin/payments", icon: CreditCard },
  { label: "Organisers", to: "/admin/organisers", icon: UserRoundCog },
  { label: "Attendance", to: "/admin/attendance", icon: ClipboardCheck },
  { label: "Certificates", to: "/admin/certificates", icon: FileBadge },
  { label: "Settings", to: "/admin/settings", icon: Settings2 },
];

interface SidebarProps {
  mobileOpen: boolean;
  collapsed: boolean;
  onClose: () => void;
  mobileDialogRef: RefObject<HTMLElement>;
}

export default function Sidebar({ mobileOpen, collapsed, onClose, mobileDialogRef }: SidebarProps) {
  return <>
    <button className={`drawer-scrim${mobileOpen ? " is-visible" : ""}`} onClick={onClose} aria-label="Close navigation" tabIndex={mobileOpen ? 0 : -1} />
    <aside ref={mobileDialogRef} className={`admin-sidebar${collapsed ? " is-collapsed" : ""}${mobileOpen ? " is-open" : ""}`} aria-label="Admin navigation" role={mobileOpen ? "dialog" : undefined} aria-modal={mobileOpen || undefined}>
      <div className="sidebar-brand-row">
        <Link className="sidebar-brand" to="/admin" aria-label="VIBRANT Admin overview" onClick={onClose}>
          <span className="sidebar-brand-mark">V</span>
          <span className="sidebar-brand-copy"><strong>VIBRANT</strong><small>ADMIN PORTAL</small></span>
        </Link>
        <button className="mobile-close icon-button" onClick={onClose} aria-label="Close navigation"><X size={19} /></button>
      </div>
      <div className="sidebar-section-label">WORKSPACE</div>
      <nav className="sidebar-nav">
        {adminNavigation.map(item => <NavigationItem key={item.to} item={item} onNavigate={onClose} />)}
      </nav>
      <div className="sidebar-bottom"><span className="sidebar-bottom-mark">V</span><span className="sidebar-bottom-copy"><strong>VIBRANT</strong><small>Campus, connected.</small></span><span className="sidebar-version">ADMIN</span></div>
    </aside>
  </>;
}
