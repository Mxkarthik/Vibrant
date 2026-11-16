import { useCallback, useEffect, useRef, useState } from "react";
import GoogleAuthModal from "../components/auth/GoogleAuthModal";
import "../styles/landing-page.css";

const navItems = [
  ["Home", "home"],
  ["Legacy", "legacy"],
  ["Experience", "experience"],
  ["Events", "events"],
  ["About", "about"],
] as const;

const categories = [
  { name: "Technical", number: "01", image: "photo-1581092921461-eab62e97a780", position: "center" },
  { name: "Cultural", number: "02", image: "photo-1523580494863-6f3031224c94", position: "center" },
  { name: "Workshops", number: "03", image: "photo-1523580494863-6f3031224c94", position: "35% center" },
  { name: "Sports", number: "04", image: "photo-1581092921461-eab62e97a780", position: "60% center" },
  { name: "Competitions", number: "05", image: "photo-1581092921461-eab62e97a780", position: "30% center" },
];

export default function ParticipantHomePage() {
  const [authOpen, setAuthOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.classList.add("participant-site");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !("IntersectionObserver" in window)) {
      document.querySelectorAll(".reveal-on-scroll").forEach((element) => element.classList.add("is-visible"));
      return () => document.documentElement.classList.remove("participant-site");
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -35px 0px" });
    document.querySelectorAll(".reveal-on-scroll").forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove("participant-site");
    };
  }, []);

  const closeMenu = () => setMenuOpen(false);
  const closeAuth = useCallback(() => setAuthOpen(false), []);

  return (
    <main className="festival-site" id="home">
      <header className="site-header">
        <a className="site-brand" href="#home" aria-label="VIBRANT2K26 home" onClick={closeMenu}>
          <span className="site-brand-name">VIBRANT<span>2K26</span></span>
          <span className="site-brand-school">DADI INSTITUTE OF ENGINEERING &amp; TECHNOLOGY</span>
        </a>
        <button
          ref={menuButtonRef}
          className="mobile-menu-toggle"
          type="button"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span /><span />
        </button>
        <nav className={`site-nav${menuOpen ? " is-open" : ""}`} aria-label="Main navigation">
          {navItems.map(([label, id]) => <a key={id} href={`#${id}`} onClick={closeMenu}>{label}</a>)}
          <button className="button button-dark nav-register" type="button" onClick={() => { closeMenu(); setAuthOpen(true); }}>
            Register Now <ArrowIcon />
          </button>
        </nav>
      </header>

      <section className="hero-section" aria-labelledby="hero-title">
        <div className="hero-copy reveal-on-load">
          <p className="eyebrow"><span className="eyebrow-rule" /> DIET, ANAKAPALLE <span className="eyebrow-separator">/</span> 20 YEARS OF LEGACY</p>
          <h1 id="hero-title">20 Years of Excellence.<br /><span>A Future of Possibilities.</span></h1>
          <p className="hero-description">Celebrating two decades of learning, innovation and ambition. VIBRANT2K26 brings together different people, different dreams and one celebration.</p>
          <div className="hero-actions">
            <button className="button button-dark" type="button" onClick={() => setAuthOpen(true)}>Register Now <ArrowIcon /></button>
            <a className="text-link" href="#experience">Explore the Celebration <span aria-hidden="true">↓</span></a>
          </div>
          <div className="anniversary-note"><span className="anniversary-number">20</span><span><strong>YEARS</strong><small>OF LEARNING &amp; POSSIBILITY</small></span></div>
        </div>
        <div className="hero-visual reveal-image">
          <img src="https://images.unsplash.com/photo-1581092921461-eab62e97a780?auto=format&fit=crop&w=1500&q=85" alt="Engineering students exploring a technical project" fetchPriority="high" />
          <div className="hero-image-caption"><span>ONE CAMPUS. COUNTLESS MOMENTS.</span><span>VIBRANT2K26</span></div>
          <div className="hero-image-index" aria-hidden="true">01 <span>/</span> 20</div>
        </div>
        <a className="scroll-cue" href="#legacy"><span />SCROLL TO DISCOVER</a>
      </section>

      <section className="legacy-section section-shell" id="legacy" aria-labelledby="legacy-title">
        <div className="legacy-photo reveal-image">
          <img src="https://images.unsplash.com/photo-1523580494863-6f3031224c94?auto=format&fit=crop&w=1100&q=85" alt="Students learning and sharing ideas in a classroom" loading="lazy" />
          <span className="photo-caption">A JOURNEY OF LEARNING</span>
        </div>
        <div className="legacy-copy reveal-on-scroll">
          <p className="eyebrow"><span className="eyebrow-rule" /> OUR LEGACY</p>
          <h2 id="legacy-title">Two Decades.<br />Countless Dreams.<br /><em>One Legacy.</em></h2>
          <p>Dadi Institute of Engineering and Technology's journey is carried forward by the curiosity, effort and ambition of its students.</p>
          <p>For twenty years, learning has opened new possibilities: building knowledge, encouraging innovation and helping students prepare for the future.</p>
          <a className="text-link text-link-underlined" href="#about">Discover our purpose <span aria-hidden="true">↗</span></a>
        </div>
        <div className="legacy-footnote"><span>DIET</span><span>ANAKAPALLE, ANDHRA PRADESH</span></div>
      </section>

      <section className="vision-section" id="about" aria-labelledby="vision-title">
        <div className="section-shell vision-inner">
          <div className="section-intro reveal-on-scroll">
            <p className="eyebrow"><span className="eyebrow-rule" /> THE VIBRANT VISION</p>
            <h2 id="vision-title">Ideas in motion.<br /><span>Possibility in every direction.</span></h2>
            <p>A celebration shaped by the ways we think, make and work through challenges together.</p>
          </div>
          <div className="vision-grid">
            <article className="vision-item reveal-on-scroll"><span className="vision-number">01</span><div className="vision-symbol" aria-hidden="true">↗</div><h3>INNOVATION</h3><p>Think beyond boundaries. Discover what is possible.</p></article>
            <article className="vision-item reveal-on-scroll"><span className="vision-number">02</span><div className="vision-symbol" aria-hidden="true">✳</div><h3>CREATIVITY</h3><p>Turn imagination into meaningful experiences.</p></article>
            <article className="vision-item reveal-on-scroll"><span className="vision-number">03</span><div className="vision-symbol" aria-hidden="true">⌘</div><h3>PROBLEM-SOLVING</h3><p>Challenge assumptions. Build solutions that matter.</p></article>
          </div>
        </div>
      </section>

      <section className="experience-section section-shell" id="experience" aria-labelledby="experience-title">
        <div className="experience-heading reveal-on-scroll">
          <div><p className="eyebrow"><span className="eyebrow-rule" /> FIND YOUR STAGE</p><h2 id="experience-title">Many ways to<br /><em>make a moment.</em></h2></div>
          <p>Explore the worlds that make up VIBRANT2K26. Each category is an invitation to take part, learn something new and share what you love.</p>
        </div>
        <div className="category-grid" id="events">
          {categories.map((category) => (
            <article className="category-card reveal-on-scroll" key={category.name}>
              <img src={`https://images.unsplash.com/${category.image}?auto=format&fit=crop&w=750&q=80`} alt={`${category.name} festival experience`} loading="lazy" style={{ objectPosition: category.position }} />
              <div className="category-shade" />
              <span className="category-index">{category.number}</span>
              <h3>{category.name}</h3>
              <span className="category-arrow" aria-hidden="true">↗</span>
            </article>
          ))}
        </div>
        <p className="category-note">EVENTS AND REGISTRATION DETAILS WILL BE SHARED HERE.</p>
      </section>

      <section className="campus-section" aria-labelledby="campus-title">
        <div className="campus-image reveal-image">
          <img src="https://images.unsplash.com/photo-1523580494863-6f3031224c94?auto=format&fit=crop&w=1900&q=85" alt="Students sharing a learning moment together" loading="lazy" />
          <div className="campus-overlay" />
          <div className="campus-copy reveal-on-scroll"><p className="eyebrow eyebrow-light"><span className="eyebrow-rule" /> TOGETHER AT DIET</p><h2 id="campus-title">Different people.<br />Different dreams.<br /><em>One celebration.</em></h2><p>Bring your curiosity, your point of view and the people you want beside you. This is a campus celebration made for sharing.</p></div>
          <span className="campus-side-note">VIBRANT2K26 · DIET ANAKAPALLE</span>
        </div>
      </section>

      <section className="registration-section section-shell" aria-labelledby="registration-title">
        <p className="eyebrow"><span className="eyebrow-rule" /> YOUR MOMENT BEGINS HERE</p>
        <h2 id="registration-title">Your Ideas<br /><em>Deserve a Stage.</em></h2>
        <p>Be part of the celebration. Bring your creativity, ambition and ideas to VIBRANT2K26.</p>
        <button className="button button-dark registration-button" type="button" onClick={() => setAuthOpen(true)}>Register for VIBRANT2K26 <ArrowIcon /></button>
        <span className="registration-mark" aria-hidden="true">V</span>
      </section>

      <footer className="site-footer">
        <div className="footer-top">
          <a className="footer-brand" href="#home"><span>VIBRANT<span>2K26</span></span><small>DADI INSTITUTE OF ENGINEERING &amp; TECHNOLOGY</small></a>
          <nav className="footer-nav" aria-label="Footer navigation">{navItems.map(([label, id]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
          <a className="footer-register" href="#home" onClick={(event) => { event.preventDefault(); setAuthOpen(true); }}>Register <span aria-hidden="true">↗</span></a>
        </div>
        <div className="footer-bottom"><span>DIET · ANAKAPALLE, ANDHRA PRADESH</span><span>ONE CAMPUS. COUNTLESS MOMENTS.</span><span>VIBRANT2K26</span></div>
      </footer>

      <GoogleAuthModal open={authOpen} onClose={closeAuth} />
    </main>
  );
}

function ArrowIcon() {
  return <svg className="arrow-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 10h11M10 4l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
