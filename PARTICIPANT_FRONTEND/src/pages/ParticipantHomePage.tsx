import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { isParticipantPortalRole, useAuth } from "../auth/AuthContext";
import GoogleAuthModal from "../components/auth/GoogleAuthModal";
import BackgroundGrid from "../components/landing/BackgroundGrid";
import LandingNavbar from "../components/landing/LandingNavbar";
import HeroSection from "../components/landing/HeroSection";
import MarqueeSection from "../components/landing/MarqueeSection";
import StorySection from "../components/landing/StorySection";
import ExperienceSection from "../components/landing/ExperienceSection";
import OpportunitySection from "../components/landing/OpportunitySection";
import EnergySection from "../components/landing/EnergySection";
import MemoriesSection from "../components/landing/MemoriesSection";
import FinaleSection from "../components/landing/FinaleSection";

import "../styles/landing-page.css";

gsap.registerPlugin(ScrollTrigger);

export default function ParticipantHomePage({
  openAuthOnMount = false,
}: {
  openAuthOnMount?: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [authOpen, setAuthOpen] = useState(openAuthOnMount);

  // Sync openAuthOnMount prop if route changes
  useEffect(() => {
    if (openAuthOnMount) {
      setAuthOpen(true);
    }
  }, [openAuthOnMount]);

  // Set up Lenis smooth scrolling with GSAP ScrollTrigger synchronization
  useEffect(() => {
    document.documentElement.classList.add("vibrant-html");

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      return () => {
        document.documentElement.classList.remove("vibrant-html");
      };
    }

    const lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: "vertical",
      gestureOrientation: "vertical",
      smoothWheel: true,
      wheelMultiplier: 1.05,
    });

    // Synchronize Lenis scroll position with GSAP ScrollTrigger
    lenis.on("scroll", ScrollTrigger.update);

    const rafCallback = (time: number) => {
      lenis.raf(time * 1000);
    };

    gsap.ticker.add(rafCallback);
    gsap.ticker.lagSmoothing(0);

    // Refresh ScrollTrigger once DOM and custom fonts are ready
    const refreshTimer = window.setTimeout(() => {
      ScrollTrigger.refresh();
    }, 150);

    if (document.fonts) {
      document.fonts.ready.then(() => {
        ScrollTrigger.refresh();
      });
    }

    return () => {
      window.clearTimeout(refreshTimer);
      gsap.ticker.remove(rafCallback);
      lenis.destroy();
      document.documentElement.classList.remove("vibrant-html");
    };
  }, []);

  const closeAuth = useCallback(() => {
    setAuthOpen(false);
  }, []);

  const handleRegister = useCallback(() => {
    if (user && isParticipantPortalRole(user.role)) {
      navigate("/dashboard");
    } else {
      setAuthOpen(true);
    }
  }, [user, navigate]);

  const handleExplore = useCallback(() => {
    const target = document.getElementById("story");
    if (target) {
      target.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  return (
    <div className="vibrant-landing-page">
      {/* Stationary Checker Grid Foundation */}
      <BackgroundGrid />

      {/* Floating Modern Editorial Navbar */}
      <LandingNavbar onOpenAuth={handleRegister} />

      {/* Main Cinematic Storytelling Sections */}
      <main id="main-content">
        {/* Section 01: Hero Arrival */}
        <HeroSection
          onRegisterClick={handleRegister}
          onExploreClick={handleExplore}
        />

        {/* Kinetic Marquee: Innovate • Perform • Celebrate */}
        <MarqueeSection />

        {/* Section 02: Beyond the Ordinary */}
        <StorySection />

        {/* Section 03: The Experience */}
        <ExperienceSection />

        {/* Section 04: Your Stage */}
        <OpportunitySection onRegisterClick={handleRegister} />

        {/* Section 05: The Energy */}
        <EnergySection />

        {/* Section 06: The Memories */}
        <MemoriesSection />

        {/* Section 07: The Next Chapter & Footer */}
        <FinaleSection onRegisterClick={handleRegister} />
      </main>

      {/* Google Sign-in Modal for Participant Registration */}
      <GoogleAuthModal open={authOpen} onClose={closeAuth} />
    </div>
  );
}
