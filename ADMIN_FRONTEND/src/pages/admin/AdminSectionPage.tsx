import { useLocation } from "react-router-dom";
import { adminNavigation } from "../../components/admin/Sidebar";
import Card from "../../components/ui/Card";
import PageHeader from "../../components/admin/PageHeader";
import OverviewDashboard from "./OverviewDashboard";

const pageDescriptions: Record<string, string> = {
  "/admin": "Your workspace for the people and experiences that bring campus to life.",
  "/admin/events": "Create and coordinate events across your institution.",
  "/admin/participants": "Review participant registrations and event involvement.",
  "/admin/payments": "Review event payments and verification activity.",
  "/admin/organisers": "Manage the people coordinating your campus events.",
  "/admin/attendance": "Support check-in and attendance reporting for events.",
  "/admin/certificates": "Issue and manage event participation certificates.",
  "/admin/settings": "Review administration preferences and account settings.",
};

export default function AdminSectionPage() {
  const { pathname } = useLocation();
  const page = adminNavigation.find(item => item.to === pathname) ?? adminNavigation[0];
  if (page.to === "/admin") return <OverviewDashboard />;
  return <>
    <PageHeader title={page.label} description={pageDescriptions[page.to]} />
    <Card className="empty-workspace">
      <div className="empty-workspace-icon"><page.icon size={20} strokeWidth={1.8} /></div>
      <p className="empty-workspace-label">WORKSPACE</p>
      <h2>{page.to === "/admin" ? "Your admin workspace is ready" : `${page.label} workspace`}</h2>
      <p>This area is ready for the next implementation phase. No data is connected yet.</p>
    </Card>
  </>;
}
