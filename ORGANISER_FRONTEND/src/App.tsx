import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { PublicOnlyRoute, RequireOrganiserOrAdmin } from "./auth/OrganiserRouteGuard";
import OrganiserLayout from "./components/layout/OrganiserLayout";
import LoginPage from "./pages/LoginPage";
import UnauthorizedPage from "./pages/UnauthorizedPage";
import EventSelectionPage from "./pages/EventSelectionPage";
import EventDashboardPage from "./pages/EventDashboardPage";
import { getActiveEventId } from "./utils/activeEventStorage";

// Route-level code splitting: ScannerPage (ZXing bundle) and AttendanceTrackerPage
const ScannerPage = lazy(() => import("./pages/ScannerPage"));
const AttendanceTrackerPage = lazy(() => import("./pages/AttendanceTrackerPage"));

function PageLoader() {
  return (
    <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--muted)" }}>
      <div className="spinner" style={{ margin: "0 auto 16px" }} />
      <p style={{ fontSize: "14px", fontWeight: 500 }}>Loading view...</p>
    </div>
  );
}

function ActiveDashboardRoute() {
  const activeEventId = getActiveEventId();
  if (activeEventId) {
    return <Navigate to={`/events/${activeEventId}/dashboard`} replace />;
  }
  return <EventDashboardPage />;
}

function ActiveTrackerRoute() {
  const activeEventId = getActiveEventId();
  if (activeEventId) {
    return <Navigate to={`/events/${activeEventId}/attendance`} replace />;
  }
  return (
    <Suspense fallback={<PageLoader />}>
      <AttendanceTrackerPage />
    </Suspense>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      {/* Unauthorized page for non-admin, non-organiser accounts */}
      <Route path="/unauthorized" element={<UnauthorizedPage />} />

      {/* Protected routes requiring ADMIN or ORGANISER role */}
      <Route element={<RequireOrganiserOrAdmin />}>
        <Route element={<OrganiserLayout />}>
          {/* Scanner-first default landing experience */}
          <Route path="/" element={<Navigate to="/scanner" replace />} />
          <Route
            path="/scanner"
            element={
              <Suspense fallback={<PageLoader />}>
                <ScannerPage />
              </Suspense>
            }
          />
          <Route path="/events" element={<EventSelectionPage />} />
          <Route path="/events/:id/dashboard" element={<EventDashboardPage />} />
          <Route
            path="/events/:id/scanner"
            element={
              <Suspense fallback={<PageLoader />}>
                <ScannerPage />
              </Suspense>
            }
          />
          <Route
            path="/events/:id/attendance"
            element={
              <Suspense fallback={<PageLoader />}>
                <AttendanceTrackerPage />
              </Suspense>
            }
          />
          <Route path="/dashboard" element={<ActiveDashboardRoute />} />
          <Route path="/tracker" element={<ActiveTrackerRoute />} />
        </Route>
      </Route>

      {/* Fallback to scanner-first landing */}
      <Route path="*" element={<Navigate to="/scanner" replace />} />
    </Routes>
  );
}
