import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";

export default function LandingNavbar({ onOpenAuth }: { onOpenAuth: () => void }) {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("hero");

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 40);

      const sections = ["hero", "story", "experience", "opportunity", "energy", "memories", "finale"];
      const scrollPosition = window.scrollY + 200;

      for (const sectionId of sections) {
        const el = document.getElementById(sectionId);
        if (el) {
          const top = el.offsetTop;
          const height = el.offsetHeight;
          if (scrollPosition >= top && scrollPosition < top + height) {
            setActiveSection(sectionId);
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    setMobileMenuOpen(false);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <>
      <header className={`vibrant-nav-wrapper ${scrolled ? "is-scrolled" : ""}`}>
        <nav className="vibrant-nav" aria-label="Main Navigation">
          <a
            href="#hero"
            className="vibrant-nav-brand"
            aria-label="VIBRANT 2K26 - Dadi Institute of Engineering and Technology"
            onClick={(e) => {
              e.preventDefault();
              scrollTo("hero");
            }}
          >
            <div className="diet-logo-wrap">
              <img
                src="/diet-logo.png"
                alt="DIET Logo"
                className="diet-nav-logo"
                width={38}
                height={32}
                loading="eager"
              />
            </div>
            <div className="diet-brand-text">
              <span className="diet-college-name font-mono">
                Dadi Institute of Engineering &amp; Technology
              </span>
              <span className="diet-college-short font-mono">
                DIET · ANAKAPALLE
              </span>
              <span className="diet-event-name font-space">
                VIBRANT<span className="accent-orange">2K26</span>
                <span className="diet-event-tag font-mono">· ANAKAPALLE</span>
              </span>
            </div>
          </a>

          <div className="vibrant-nav-links font-sans">
            <button
              type="button"
              className={`nav-link-btn ${activeSection === "story" ? "active" : ""}`}
              onClick={() => scrollTo("story")}
            >
              Story
            </button>
            <button
              type="button"
              className={`nav-link-btn ${activeSection === "experience" ? "active" : ""}`}
              onClick={() => scrollTo("experience")}
            >
              The Experience
            </button>
            <button
              type="button"
              className={`nav-link-btn ${activeSection === "energy" ? "active" : ""}`}
              onClick={() => scrollTo("energy")}
            >
              Energy
            </button>
            <Link to="/events" className="nav-link-btn">
              Events
            </Link>
          </div>

          <div className="vibrant-nav-actions">
            {user ? (
              <Link to="/dashboard" className="nav-btn-account font-mono">
                <span className="account-dot" />
                {user.name.split(" ")[0]}
              </Link>
            ) : (
              <button
                type="button"
                className="nav-btn-register font-sans"
                onClick={onOpenAuth}
              >
                Register Now ↗
              </button>
            )}

            <button
              type="button"
              className={`nav-mobile-toggle ${mobileMenuOpen ? "is-active" : ""}`}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <span className="toggle-line" />
              <span className="toggle-line" />
            </button>
          </div>
        </nav>
      </header>

      {/* Mobile Drawer */}
      <div className={`vibrant-mobile-drawer ${mobileMenuOpen ? "is-open" : ""}`} aria-hidden={!mobileMenuOpen}>
        <div className="mobile-drawer-inner">
          <div className="mobile-drawer-brand">
            <div className="mobile-drawer-logo-wrap">
              <img
                src="/diet-logo.png"
                alt="DIET Logo"
                className="mobile-drawer-logo"
                width={42}
                height={35}
              />
            </div>
            <div className="mobile-drawer-brand-text">
              <span className="mobile-drawer-college font-mono">
                Dadi Institute of Engineering &amp; Technology
              </span>
              <span className="mobile-drawer-event font-space">
                VIBRANT<span className="accent-orange">2K26</span>
              </span>
            </div>
          </div>

          <div className="mobile-links font-space">
            <button
              type="button"
              onClick={() => scrollTo("story")}
            >
              <span className="link-num font-mono">01</span> The Story
            </button>
            <button
              type="button"
              onClick={() => scrollTo("experience")}
            >
              <span className="link-num font-mono">02</span> The Experience
            </button>
            <button
              type="button"
              onClick={() => scrollTo("energy")}
            >
              <span className="link-num font-mono">03</span> Energy
            </button>
            <button
              type="button"
              onClick={() => scrollTo("memories")}
            >
              <span className="link-num font-mono">04</span> Memories
            </button>
            <Link
              to="/events"
              onClick={() => setMobileMenuOpen(false)}
            >
              <span className="link-num font-mono">05</span> Explore Events ↗
            </Link>
          </div>

          <div className="mobile-actions">
            {user ? (
              <Link
                to="/dashboard"
                className="mobile-cta-btn"
                onClick={() => setMobileMenuOpen(false)}
              >
                Go to Dashboard ↗
              </Link>
            ) : (
              <button
                type="button"
                className="mobile-cta-btn"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenAuth();
                }}
              >
                Register for VIBRANT 2K26 ↗
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
