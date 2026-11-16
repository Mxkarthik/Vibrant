import { useState } from "react";
import IntroExperience from "./components/intro/IntroExperience";
import ParticipantHomePage from "./pages/ParticipantHomePage";

export default function App() {
  const [showIntro, setShowIntro] = useState(true);

  return showIntro ? <IntroExperience onComplete={() => setShowIntro(false)} /> : <ParticipantHomePage />;
}
