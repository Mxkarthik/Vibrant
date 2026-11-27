import { Route, Routes } from "react-router-dom";
import { NotFoundPage, PublicOnlyRoute, RequireAdmin, UnauthorizedPage } from "./auth/RouteGuards";
import LoginPage from "./pages/LoginPage";
import AdminLayout from "./components/admin/AdminLayout";
import AdminSectionPage from "./pages/admin/AdminSectionPage";
import EventsPage from "./pages/admin/EventsPage";
import CreateEventPage from "./pages/admin/CreateEventPage";
import EditEventPage from "./pages/admin/EditEventPage";
import EventDetailsPage from "./pages/admin/EventDetailsPage";
import ParticipantsPage from "./pages/admin/ParticipantsPage";
import PaymentsPage from "./pages/admin/PaymentsPage";
import OrganisersPage from "./pages/admin/OrganisersPage";
import AttendancePage from "./pages/admin/AttendancePage";
import CertificatesPage from "./pages/admin/CertificatesPage";
import AccountSettingsPage from "./pages/admin/AccountSettingsPage";
import DomainsPage from "./pages/admin/DomainsPage";

export default function App() {
  return <Routes>
    <Route element={<PublicOnlyRoute />}><Route path="/" element={<LoginPage />} /><Route path="/login" element={<LoginPage />} /></Route>
    <Route element={<RequireAdmin />}><Route element={<AdminLayout />}>
      <Route path="/admin" element={<AdminSectionPage />} />
      <Route path="/admin/events" element={<EventsPage />} />
      <Route path="/admin/events/new" element={<CreateEventPage />} />
      <Route path="/admin/events/:id/edit" element={<EditEventPage />} />
      <Route path="/admin/events/:id/domains" element={<DomainsPage />} />
      <Route path="/admin/events/:id" element={<EventDetailsPage />} />
      <Route path="/admin/participants" element={<ParticipantsPage />} />
      <Route path="/admin/payments" element={<PaymentsPage />} />
      <Route path="/admin/organisers" element={<OrganisersPage />} />
      <Route path="/admin/attendance" element={<AttendancePage />} />
      <Route path="/admin/certificates" element={<CertificatesPage />} />
      <Route path="/admin/settings" element={<AccountSettingsPage />} />
    </Route></Route>
    <Route path="/unauthorized" element={<UnauthorizedPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes>;
}
