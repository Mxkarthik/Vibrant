import { useCallback, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ToastProvider } from "./components/toast/ToastContext";
import { ParticipantLoginRoute, ParticipantNotFound, RequireParticipant } from "./auth/RouteGuards";
import ParticipantLayout from "./components/layout/ParticipantLayout";
import IntroExperience from "./components/intro/IntroExperience";
import OAuthCallbackPage from "./pages/OAuthCallbackPage";
import ParticipantDashboardPage from "./pages/ParticipantDashboardPage";
import ExploreEventsPage from "./pages/ExploreEventsPage";
import EventDetailsPage from "./pages/EventDetailsPage";
import IndividualRegistrationPage from "./pages/IndividualRegistrationPage";
import RegistrationReceiptPage from "./pages/RegistrationReceiptPage";
import MyRegistrationsPage from "./pages/MyRegistrationsPage";
import DigitalTicketPage from "./pages/DigitalTicketPage";
import TeamTicketsPage from "./pages/TeamTicketsPage";
import TeamRegistrationPage from "./pages/TeamRegistrationPage";
import TeamDetailsPage from "./pages/TeamDetailsPage";
import ParticipantHomePage from "./pages/ParticipantHomePage";
import ParticipantPlaceholderPage from "./pages/ParticipantPlaceholderPage";
import MyAttendancePage from "./pages/MyAttendancePage";
import MyCertificatesPage from "./pages/MyCertificatesPage";
import "./styles/participant-app.css";
import "./styles/ticket.css";

export default function App() {
  const [showIntro, setShowIntro] = useState(true);
  const completeIntro = useCallback(() => setShowIntro(false), []);

  if (showIntro) return <IntroExperience onComplete={completeIntro} />;

  return <BrowserRouter>
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<ParticipantHomePage />} />
          <Route path="/login" element={<ParticipantLoginRoute><ParticipantHomePage openAuthOnMount /></ParticipantLoginRoute>} />
          <Route path="/auth/callback" element={<OAuthCallbackPage />} />
          <Route element={<RequireParticipant />}>
            <Route element={<ParticipantLayout />}>
              <Route path="/dashboard" element={<ParticipantDashboardPage />} />
              <Route path="/events" element={<ExploreEventsPage />} />
              <Route path="/events/:eventId" element={<EventDetailsPage />} />
              <Route path="/events/:eventId/register" element={<IndividualRegistrationPage />} />
              <Route path="/events/:eventId/register-team" element={<TeamRegistrationPage />} />
              <Route path="/my-registrations" element={<MyRegistrationsPage />} />
              <Route path="/my-attendance" element={<MyAttendancePage />} />
              <Route path="/my-certificates" element={<MyCertificatesPage />} />
              <Route path="/registrations" element={<MyRegistrationsPage />} />
              <Route path="/registrations/:registrationId" element={<RegistrationReceiptPage />} />
              <Route path="/registrations/:registrationId/ticket" element={<DigitalTicketPage />} />
              <Route path="/teams/:teamId" element={<TeamDetailsPage />} />
              <Route path="/teams/:teamId/tickets" element={<TeamTicketsPage />} />
              <Route path="/profile" element={<ParticipantPlaceholderPage type="profile" />} />
            </Route>
          </Route>
          <Route path="*" element={<ParticipantNotFound />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  </BrowserRouter>;
}
