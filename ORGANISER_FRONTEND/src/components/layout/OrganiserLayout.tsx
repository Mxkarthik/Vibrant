import { Outlet } from "react-router-dom";
import OrganiserHeader from "./OrganiserHeader";
import BottomNavigation from "./BottomNavigation";

export default function OrganiserLayout() {
  return (
    <div className="app-shell">
      <OrganiserHeader />
      <main className="main-content">
        <Outlet />
      </main>
      <BottomNavigation />
    </div>
  );
}
