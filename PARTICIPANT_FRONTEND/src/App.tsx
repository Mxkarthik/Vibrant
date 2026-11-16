import { useState } from "react";
import IntroExperience from "./components/intro/IntroExperience";
import OAuthCallbackPage from "./pages/OAuthCallbackPage";
import ParticipantHomePage from "./pages/ParticipantHomePage";

export default function App() {
  const [showIntro, setShowIntro] = useState(true);

  if (showIntro) return <IntroExperience onComplete={() => setShowIntro(false)} />;
  return window.location.pathname === "/auth/callback" ? <OAuthCallbackPage /> : <ParticipantHomePage />;
}
