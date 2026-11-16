import { useCallback, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";

export default function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const mobileNavigationRef = useAccessibleDialog(closeMobile, false, mobileOpen);
  return <div className={`admin-shell${collapsed ? " sidebar-collapsed" : ""}`}>
    <Sidebar mobileOpen={mobileOpen} collapsed={collapsed} onClose={closeMobile} mobileDialogRef={mobileNavigationRef} />
    <div className="admin-main-column">
      <Topbar collapsed={collapsed} onToggleSidebar={() => setCollapsed(value => !value)} onOpenMobile={() => setMobileOpen(true)} />
      <main className="admin-content"><Outlet /></main>
      <footer className="admin-footer"><span>VIBRANT Administration</span><span>Campus, connected.</span></footer>
    </div>
  </div>;
}
