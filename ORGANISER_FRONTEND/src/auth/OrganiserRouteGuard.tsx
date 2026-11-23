import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function LoadingScreen() {
  return (
    <main className="auth-page" aria-live="polite">
      <div className="auth-card" style={{ width: "auto", minWidth: "300px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px" }}>
          <span
            style={{
              width: "20px",
              height: "20px",
              border: "2px solid #cbd5e1",
              borderTopColor: "var(--blue)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <p style={{ margin: 0, fontSize: "14px", color: "var(--secondary)" }}>
            Restoring organiser session…
          </p>
        </div>
      </div>
    </main>
  );
}

export function PublicOnlyRoute() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user && (user.role === "ADMIN" || user.role === "ORGANISER")) {
    return <Navigate to="/scanner" replace />;
  }
  return <Outlet />;
}

export function RequireOrganiserOrAdmin() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Reject participants and any unapproved roles
  if (user.role !== "ADMIN" && user.role !== "ORGANISER") {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
