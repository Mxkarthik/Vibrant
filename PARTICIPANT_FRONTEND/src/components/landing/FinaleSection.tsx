import { Link } from "react-router-dom";

export default function FinaleSection({ onRegisterClick }: { onRegisterClick: () => void }) {
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section id="finale" className="vibrant-finale-section" aria-label="Final Invitation">
      <div className="finale-container">
        <span className="section-label-badge font-mono">06 / THE NEXT CHAPTER</span>

        <h2 className="finale-monumental-headline font-space">
          YOUR MOMENT <br />
          <span className="accent-orange">IS WAITING.</span>
        </h2>

        <p className="finale-subtext font-sans">
          The ideas. The talent. The energy. The memories. <br />
          There&apos;s a place for you at VIBRANT 2K26.
        </p>

        <div className="finale-cta-group font-sans">
          <button
            type="button"
            className="finale-primary-btn"
            onClick={onRegisterClick}
          >
            Register for VIBRANT 2K26 ↗
          </button>
          <Link to="/events" className="finale-secondary-btn">
            Explore All Events
          </Link>
        </div>

        {/* Wordmark returning as iconic anchor */}
        <div className="finale-wordmark-wrap" aria-hidden="true">
          <span className="finale-wordmark font-space">VIBRANT2K26</span>
        </div>
      </div>

      {/* Modern Light Festival Footer */}
      <footer className="vibrant-footer font-sans">
        <div className="footer-top-row">
          <div className="footer-brand-lockup">
            <div className="footer-brand-top">
              <div className="footer-diet-logo-wrap">
                <img
                  src="/diet-logo.png"
                  alt="DIET - Dadi Institute of Engineering & Technology"
                  className="footer-diet-logo"
                  width={52}
                  height={43}
                  loading="lazy"
                />
              </div>
              <div className="footer-brand-headings">
                <span className="footer-college-name font-mono">
                  DADI INSTITUTE OF ENGINEERING &amp; TECHNOLOGY
                </span>
                <span className="footer-brand-title font-space">
                  VIBRANT<span className="accent-orange">2K26</span>
                </span>
              </div>
            </div>
            <p className="footer-brand-subtitle font-mono">
              AN AUTONOMOUS INSTITUTION · NAAC &amp; NBA ACCREDITED <br />
              AFFILIATED TO JNTU-GURAZADA, VIZIANAGARAM · APPROVED BY AICTE
            </p>
          </div>

          <div className="footer-nav-columns font-sans">
            <div className="footer-nav-col">
              <span className="col-heading font-mono">CHAPTERS</span>
              <button type="button" onClick={() => scrollTo("hero")}>The Arrival</button>
              <button type="button" onClick={() => scrollTo("story")}>The Story</button>
              <button type="button" onClick={() => scrollTo("experience")}>The Experience</button>
              <button type="button" onClick={() => scrollTo("energy")}>The Energy</button>
            </div>
            <div className="footer-nav-col">
              <span className="col-heading font-mono">PARTICIPATION</span>
              <Link to="/events">Browse Events</Link>
              <button type="button" onClick={onRegisterClick}>Register Portal</button>
              <Link to="/my-registrations">My Passes &amp; Tickets</Link>
            </div>
            <div className="footer-nav-col">
              <span className="col-heading font-mono">CONTACT &amp; VENUE</span>
              <a href="mailto:admissions@diet.edu.in">admissions@diet.edu.in</a>
              <a href="tel:+919963981111">+91 99639 81111</a>
              <span className="col-address font-mono">NH-16, ANAKAPALLE, VISAKHAPATNAM, AP 531002</span>
            </div>
          </div>
        </div>

        <div className="footer-bottom-row font-mono">
          <span>&copy; 2026 VIBRANT2K26 · DADI INSTITUTE OF ENGINEERING &amp; TECHNOLOGY</span>
          <span>ONE CAMPUS. COUNTLESS MOMENTS.</span>
          <span>ALL RIGHTS RESERVED</span>
        </div>
      </footer>
    </section>
  );
}
