import { NavLink } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

export interface AdminNavigationItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

export default function NavigationItem({ item, onNavigate }: { item: AdminNavigationItem; onNavigate?: () => void }) {
  const Icon = item.icon;
  return <NavLink to={item.to} end={item.to === "/admin"} onClick={onNavigate} className={({ isActive }) => `nav-item${isActive ? " is-active" : ""}`}>
    <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
    <span>{item.label}</span>
  </NavLink>;
}
