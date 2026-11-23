import { useLocation, useNavigate, useParams } from "react-router-dom";
import { QrCode, Calendar, ClipboardList, BarChart2 } from "lucide-react";
import { getActiveEventId, setActiveEventId } from "../../utils/activeEventStorage";

export default function BottomNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const { id: routeEventId } = useParams<{ id?: string }>();

  // Resolve active event ID: route parameter takes precedence, then stored ID
  const activeEventId = routeEventId || getActiveEventId();
  if (routeEventId) {
    setActiveEventId(routeEventId);
  }

  const pathname = location.pathname;

  // Active state detection matching redesign spec
  const isScanActive = pathname === "/scanner" || pathname.endsWith("/scanner");
  const isEventsActive = pathname === "/events";
  const isTrackerActive = pathname.endsWith("/attendance") || pathname === "/tracker";
  const isDashboardActive = pathname.endsWith("/dashboard") || pathname === "/dashboard";

  const handleNav = (tab: "scan" | "events" | "tracker" | "dashboard") => {
    switch (tab) {
      case "scan":
        if (activeEventId) {
          navigate(`/events/${activeEventId}/scanner`);
        } else {
          navigate("/scanner");
        }
        break;
      case "events":
        navigate("/events");
        break;
      case "tracker":
        if (activeEventId) {
          navigate(`/events/${activeEventId}/attendance`);
        } else {
          navigate("/tracker");
        }
        break;
      case "dashboard":
        if (activeEventId) {
          navigate(`/events/${activeEventId}/dashboard`);
        } else {
          navigate("/dashboard");
        }
        break;
    }
  };

  return (
    <nav className="bottom-dock-wrapper" aria-label="Application Navigation">
      <div className="bottom-dock">
        {/* 1. Scan Tab */}
        <button
          type="button"
          onClick={() => handleNav("scan")}
          className={`dock-item ${isScanActive ? "is-active" : ""}`}
          aria-label="Scanner"
          aria-current={isScanActive ? "page" : undefined}
        >
          <QrCode size={18} strokeWidth={2.2} />
          <span className="dock-item-label">Scan</span>
        </button>

        {/* 2. Events Tab */}
        <button
          type="button"
          onClick={() => handleNav("events")}
          className={`dock-item ${isEventsActive ? "is-active" : ""}`}
          aria-label="Events"
          aria-current={isEventsActive ? "page" : undefined}
        >
          <Calendar size={18} strokeWidth={2.2} />
          <span className="dock-item-label">Events</span>
        </button>

        {/* 3. Tracker Tab */}
        <button
          type="button"
          onClick={() => handleNav("tracker")}
          className={`dock-item ${isTrackerActive ? "is-active" : ""}`}
          aria-label="Attendance Tracker"
          aria-current={isTrackerActive ? "page" : undefined}
        >
          <ClipboardList size={18} strokeWidth={2.2} />
          <span className="dock-item-label">Tracker</span>
        </button>

        {/* 4. Dashboard Tab */}
        <button
          type="button"
          onClick={() => handleNav("dashboard")}
          className={`dock-item ${isDashboardActive ? "is-active" : ""}`}
          aria-label="Dashboard"
          aria-current={isDashboardActive ? "page" : undefined}
        >
          <BarChart2 size={18} strokeWidth={2.2} />
          <span className="dock-item-label">Dashboard</span>
        </button>
      </div>
    </nav>
  );
}
