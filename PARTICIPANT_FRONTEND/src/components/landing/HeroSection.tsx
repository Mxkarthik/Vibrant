import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export default function HeroSection({
  onRegisterClick,
  onExploreClick,
}: {
  onRegisterClick: () => void;
  onExploreClick: () => void;
}) {
  const heroRef = useRef<HTMLDivElement>(null);
  const outerWrapperRef = useRef<HTMLDivElement>(null);
  const innerWrapperRef = useRef<HTMLDivElement>(null);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const kickerRef = useRef<HTMLParagraphElement>(null);
  const taglineRef = useRef<HTMLParagraphElement>(null);
  const subtextRef = useRef<HTMLParagraphElement>(null);
  const ctaGroupRef = useRef<HTMLDivElement>(null);
  const scrollCueRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const ctx = gsap.context(() => {
      if (reducedMotion) {
        gsap.set(outerWrapperRef.current, {
          opacity: 1,
          filter: "blur(0px)",
          y: 0,
          scale: 1,
          pointerEvents: "auto",
        });
        gsap.set(
          [
            kickerRef.current,
            titleRef.current,
            taglineRef.current,
            subtextRef.current,
            ctaGroupRef.current,
            scrollCueRef.current,
          ],
          {
            opacity: 1,
            y: 0,
            scale: 1,
          }
        );
        return;
      }

      // 1. Initial entrance animation (targets inner elements ONLY)
      const entranceTl = gsap.timeline({
        defaults: { ease: "power3.out" },
        delay: 0.15,
      });

      entranceTl
        .fromTo(
          kickerRef.current,
          { opacity: 0, y: 15 },
          { opacity: 1, y: 0, duration: 0.85 }
        )
        .fromTo(
          titleRef.current,
          { opacity: 0, y: 35, scale: 0.96 },
          { opacity: 1, y: 0, scale: 1, duration: 1.0 },
          "-=0.6"
        )
        .fromTo(
          taglineRef.current,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.8 },
          "-=0.6"
        )
        .fromTo(
          subtextRef.current,
          { opacity: 0, y: 16 },
          { opacity: 1, y: 0, duration: 0.8 },
          "-=0.6"
        )
        .fromTo(
          ctaGroupRef.current,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.8 },
          "-=0.5"
        )
        .fromTo(
          scrollCueRef.current,
          { opacity: 0 },
          { opacity: 1, duration: 0.8 },
          "-=0.4"
        );

      // 2. Reversible scroll exit animation (targets outer wrapper ONLY)
      // When scrolling down: opacity 1 -> 0, blur 0 -> 4px, translateY 0 -> -30px, scale 1 -> 1.04
      // When scrolling up: opacity 0 -> 1, blur 4px -> 0px, translateY -30px -> 0px, scale 1.04 -> 1
      const scrollTl = gsap.timeline({
        scrollTrigger: {
          trigger: heroRef.current,
          start: "top top",
          end: "+=60%",
          pin: true,
          pinSpacing: true,
          scrub: 0.6,
          invalidateOnRefresh: true,
          onEnter: () => {
            if (outerWrapperRef.current) {
              outerWrapperRef.current.style.pointerEvents = "auto";
            }
          },
          onLeave: () => {
            if (outerWrapperRef.current) {
              outerWrapperRef.current.style.pointerEvents = "none";
            }
          },
          onEnterBack: () => {
            if (outerWrapperRef.current) {
              outerWrapperRef.current.style.pointerEvents = "auto";
            }
          },
          onLeaveBack: () => {
            if (outerWrapperRef.current) {
              gsap.set(outerWrapperRef.current, {
                opacity: 1,
                filter: "blur(0px)",
                y: 0,
                scale: 1,
                pointerEvents: "auto",
              });
            }
          },
          onUpdate: (self) => {
            if (!outerWrapperRef.current) return;
            if (self.progress <= 0.005) {
              gsap.set(outerWrapperRef.current, {
                opacity: 1,
                filter: "blur(0px)",
                y: 0,
                scale: 1,
                pointerEvents: "auto",
              });
            } else if (self.progress >= 0.995) {
              outerWrapperRef.current.style.pointerEvents = "none";
            } else {
              outerWrapperRef.current.style.pointerEvents = "auto";
            }
          },
        },
      });

      scrollTl.fromTo(
        outerWrapperRef.current,
        {
          opacity: 1,
          filter: "blur(0px)",
          y: 0,
          scale: 1,
        },
        {
          opacity: 0,
          filter: "blur(4px)",
          y: -30,
          scale: 1.04,
          ease: "none",
        }
      );
    }, heroRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={heroRef} id="hero" className="vibrant-hero-section" aria-label="Hero Section">
      {/* Outer Hero Animation Wrapper: Controls scroll-driven blur, opacity, scale, and translation */}
      <div ref={outerWrapperRef} className="hero-scroll-wrapper">
        {/* Decorative corner framing marks */}
        <div className="hero-corner-mark top-left" aria-hidden="true">⌜</div>
        <div className="hero-corner-mark top-right" aria-hidden="true">⌝</div>
        <div className="hero-corner-mark bottom-left" aria-hidden="true">⌞</div>
        <div className="hero-corner-mark bottom-right" aria-hidden="true">⌟</div>

        {/* Inner Hero Content Wrapper: Controls initial staggered entrance animations */}
        <div ref={innerWrapperRef} className="hero-content-wrapper">
          <p ref={kickerRef} className="hero-college-kicker font-mono">
            <span className="kicker-logo-wrap" aria-hidden="true">
              <img
                src="/diet-logo.png"
                alt="DIET Logo"
                className="kicker-diet-logo"
                width={22}
                height={18}
                loading="eager"
              />
            </span>
            <span className="kicker-badge">ANNUAL FLAGSHIP FESTIVAL</span>
            <span className="kicker-divider">/</span>
            <span className="kicker-college">DADI INSTITUTE OF ENGINEERING &amp; TECHNOLOGY PRESENTS</span>
          </p>

          <h1 ref={titleRef} className="hero-main-title font-space">
            <span className="title-word title-vibrant">VIBRANT</span>
            <span className="title-word title-edition accent-orange">2K26</span>
          </h1>

          <p ref={taglineRef} className="hero-tagline font-space">
            Not just an event. A feeling you live.
          </p>

          <p ref={subtextRef} className="hero-description font-sans">
            Where innovation meets imagination, talent takes the stage, and ordinary moments become extraordinary memories.
          </p>

          <div ref={ctaGroupRef} className="hero-cta-group font-sans">
            <button
              type="button"
              className="hero-btn-primary"
              onClick={onRegisterClick}
            >
              Register Now ↗
            </button>
            <button
              type="button"
              className="hero-btn-secondary"
              onClick={onExploreClick}
            >
              Explore the Experience ↓
            </button>
          </div>
        </div>

        <div ref={scrollCueRef} className="hero-scroll-cue font-mono" onClick={onExploreClick}>
          <span className="scroll-cue-text">SCROLL TO DISCOVER</span>
          <div className="scroll-cue-indicator">
            <div className="scroll-cue-pill" />
          </div>
        </div>
      </div>
    </section>
  );
}
