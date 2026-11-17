import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";

export default function ExperienceSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  // Text stages
  const stage1TextRef = useRef<HTMLDivElement>(null);
  const stage2TextRef = useRef<HTMLDivElement>(null);
  const stage3TextRef = useRef<HTMLDivElement>(null);

  // SVG stages
  const svgInnovateRef = useRef<SVGGElement>(null);
  const svgPerformRef = useRef<SVGGElement>(null);
  const svgCelebrateRef = useRef<SVGGElement>(null);

  const [activeStage, setActiveStage] = useState(1);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !containerRef.current) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top top",
          end: "+=300%",
          pin: true,
          scrub: 0.8,
          onUpdate: (self) => {
            const p = self.progress;
            if (progressBarRef.current) {
              progressBarRef.current.style.transform = `scaleX(${p})`;
            }
            if (p < 0.33) {
              setActiveStage(1);
            } else if (p < 0.67) {
              setActiveStage(2);
            } else {
              setActiveStage(3);
            }
          },
        },
      });

      // Initial state: Stage 1 active, Stage 2 and 3 hidden
      gsap.set(stage1TextRef.current, { opacity: 1, y: 0, filter: "blur(0px)" });
      gsap.set([stage2TextRef.current, stage3TextRef.current], { opacity: 0, y: 30, filter: "blur(4px)" });

      gsap.set(svgInnovateRef.current, { opacity: 1, scale: 1 });
      gsap.set([svgPerformRef.current, svgCelebrateRef.current], { opacity: 0, scale: 0.85 });

      // Step 1: Innovate to Perform
      tl.to(stage1TextRef.current, {
        opacity: 0,
        y: -30,
        filter: "blur(4px)",
        duration: 0.8,
        ease: "power2.inOut",
      }, 0.8)
        .to(svgInnovateRef.current, {
          opacity: 0,
          scale: 1.1,
          duration: 0.8,
          ease: "power2.inOut",
        }, 0.8)
        .fromTo(stage2TextRef.current,
          { opacity: 0, y: 30, filter: "blur(4px)" },
          { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.8, ease: "power2.out" },
          1.1
        )
        .fromTo(svgPerformRef.current,
          { opacity: 0, scale: 0.9 },
          { opacity: 1, scale: 1, duration: 0.8, ease: "power2.out" },
          1.1
        );

      // Step 2: Perform to Celebrate
      tl.to(stage2TextRef.current, {
        opacity: 0,
        y: -30,
        filter: "blur(4px)",
        duration: 0.8,
        ease: "power2.inOut",
      }, 2.0)
        .to(svgPerformRef.current, {
          opacity: 0,
          scale: 1.1,
          duration: 0.8,
          ease: "power2.inOut",
        }, 2.0)
        .fromTo(stage3TextRef.current,
          { opacity: 0, y: 30, filter: "blur(4px)" },
          { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.8, ease: "power2.out" },
          2.3
        )
        .fromTo(svgCelebrateRef.current,
          { opacity: 0, scale: 0.9 },
          { opacity: 1, scale: 1, duration: 0.8, ease: "power2.out" },
          2.3
        );

    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} id="experience" className="vibrant-experience-section" aria-label="The Experience">
      <div className="experience-container">
        {/* Left Column: Narrative with 3 morphing stages */}
        <div className="experience-narrative-col">
          <div className="experience-header-meta">
            <span className="section-label-badge font-mono">02 / THE EXPERIENCE</span>
            <div className="experience-stages-nav font-mono">
              <span className={`stage-nav-pill ${activeStage === 1 ? "is-active" : ""}`}>01 INNOVATE</span>
              <span className={`stage-nav-pill ${activeStage === 2 ? "is-active" : ""}`}>02 PERFORM</span>
              <span className={`stage-nav-pill ${activeStage === 3 ? "is-active" : ""}`}>03 CELEBRATE</span>
            </div>
          </div>

          <div className="experience-progress-track">
            <div ref={progressBarRef} className="experience-progress-bar" />
          </div>

          <h2 className="experience-title-lead font-space">
            One festival. <span className="accent-orange">Every kind of you.</span>
          </h2>

          <div className="experience-stages-viewport">
            {/* Stage 1: INNOVATE */}
            <div ref={stage1TextRef} className="experience-stage-content">
              <span className="stage-eyebrow font-mono text-orange">STAGE 01 · INNOVATION &amp; TECH</span>
              <h3 className="stage-headline font-space">
                Think beyond. <br />Build differently.
              </h3>
              <p className="stage-description font-sans">
                For curious minds, bold thinkers, problem-solvers, and creators. Turn your ideas into possibilities and challenge what already exists.
              </p>
              <div className="stage-tags font-mono">
                <span>HACKATHONS</span>
                <span>PROJECT EXPO</span>
                <span>CIRCUIT CRAFT</span>
                <span>AI ARENA</span>
              </div>
            </div>

            {/* Stage 2: PERFORM */}
            <div ref={stage2TextRef} className="experience-stage-content">
              <span className="stage-eyebrow font-mono text-blue">STAGE 02 · CULTURAL &amp; ARTS</span>
              <h3 className="stage-headline font-space">
                Your talent deserves <br />the spotlight.
              </h3>
              <p className="stage-description font-sans">
                Step beyond hesitation. Express yourself, own the stage, and let your talent speak louder than your fears.
              </p>
              <div className="stage-tags font-mono">
                <span>BEAT BOXING</span>
                <span>BATTLE OF BANDS</span>
                <span>SOLO &amp; GROUP DANCE</span>
                <span>THEATRE</span>
              </div>
            </div>

            {/* Stage 3: CELEBRATE */}
            <div ref={stage3TextRef} className="experience-stage-content">
              <span className="stage-eyebrow font-mono text-lime">STAGE 03 · FESTIVAL &amp; FUN</span>
              <h3 className="stage-headline font-space">
                Good moments. Great people. <br />Unforgettable energy.
              </h3>
              <p className="stage-description font-sans">
                Laugh louder, make new connections, discover unexpected experiences, and celebrate everything that makes college life extraordinary.
              </p>
              <div className="stage-tags font-mono">
                <span>CAMPUS CARNIVAL</span>
                <span>LAN GAMING</span>
                <span>INFORMALS</span>
                <span>DJ NIGHT</span>
              </div>
              <div className="stage-action-cta">
                <Link to="/events" className="stage-cta-btn font-sans">
                  Find Your Event ↗
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Persistent Morphing SVG Composition */}
        <div className="experience-visual-col">
          <div className="experience-canvas-box">
            <div className="canvas-tech-badge font-mono">
              <span>VISUAL SYSTEM · 02</span>
              <span>{activeStage === 1 ? "SYS_INNOVATE" : activeStage === 2 ? "SYS_PERFORM" : "SYS_CELEBRATE"}</span>
            </div>

            <svg
              className="experience-svg"
              viewBox="0 0 440 440"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-label="Experience Visual Morphing Canvas"
            >
              {/* Underlying Technical Grid */}
              <defs>
                <pattern id="exp-grid" width="22" height="22" patternUnits="userSpaceOnUse">
                  <path d="M 22 0 L 0 0 0 22" fill="none" stroke="#E9E9E4" strokeWidth="0.8" />
                </pattern>
              </defs>
              <rect width="440" height="440" fill="url(#exp-grid)" />

              {/* Stage 1: INNOVATE VISUAL (Geometric modules, assembly lines, orange highlights) */}
              <g ref={svgInnovateRef} className="svg-stage svg-innovate">
                <rect x="70" y="70" width="130" height="130" rx="10" fill="#FFFFFF" stroke="#171717" strokeWidth="2" />
                <rect x="240" y="70" width="130" height="130" rx="10" fill="#FFFFFF" stroke="#F06436" strokeWidth="2.5" />
                <rect x="70" y="240" width="130" height="130" rx="10" fill="#F06436" fillOpacity="0.08" stroke="#F06436" strokeWidth="2" />
                <rect x="240" y="240" width="130" height="130" rx="10" fill="#FFFFFF" stroke="#171717" strokeWidth="2" />

                {/* Circuit interconnects */}
                <line x1="200" y1="135" x2="240" y2="135" stroke="#F06436" strokeWidth="2.5" />
                <circle cx="200" cy="135" r="4" fill="#F06436" />
                <circle cx="240" cy="135" r="4" fill="#F06436" />

                <line x1="135" y1="200" x2="135" y2="240" stroke="#171717" strokeWidth="2" />
                <line x1="305" y1="200" x2="305" y2="240" stroke="#171717" strokeWidth="2" />
                <line x1="200" y1="305" x2="240" y2="305" stroke="#F06436" strokeWidth="2" />

                {/* Central processor badge */}
                <circle cx="220" cy="220" r="32" fill="#FFFFFF" stroke="#171717" strokeWidth="2" />
                <circle cx="220" cy="220" r="14" fill="#F06436" />
                <text x="220" y="224" textAnchor="middle" fill="#FFFFFF" fontSize="10" fontFamily="JetBrains Mono" fontWeight="bold">IO</text>
              </g>

              {/* Stage 2: PERFORM VISUAL (Spotlight cones, resonant audio waveforms, cobalt blue) */}
              <g ref={svgPerformRef} className="svg-stage svg-perform">
                {/* Spotlight cone paths */}
                <path d="M 220 50 L 80 390 L 360 390 Z" fill="#3154E8" fillOpacity="0.07" stroke="#3154E8" strokeWidth="1" strokeDasharray="4 4" />
                <circle cx="220" cy="50" r="18" fill="#3154E8" />
                <circle cx="220" cy="50" r="30" stroke="#3154E8" strokeWidth="1.5" strokeOpacity="0.4" fill="none" />

                {/* Resonant audio wave curves */}
                <path d="M 70 240 Q 145 150, 220 240 T 370 240" fill="none" stroke="#3154E8" strokeWidth="3" />
                <path d="M 90 270 Q 155 200, 220 270 T 350 270" fill="none" stroke="#171717" strokeWidth="2" strokeOpacity="0.6" />
                <path d="M 110 300 Q 165 240, 220 300 T 330 300" fill="none" stroke="#3154E8" strokeWidth="2" strokeOpacity="0.4" />

                {/* Stage platform */}
                <ellipse cx="220" cy="380" rx="140" ry="24" fill="#FFFFFF" stroke="#3154E8" strokeWidth="2" />
                <ellipse cx="220" cy="380" rx="80" ry="14" fill="#3154E8" fillOpacity="0.15" />
              </g>

              {/* Stage 3: CELEBRATE VISUAL (Exploding abstract geometric confetti, lime accents) */}
              <g ref={svgCelebrateRef} className="svg-stage svg-celebrate">
                <circle cx="220" cy="220" r="80" stroke="#171717" strokeWidth="2" strokeDasharray="8 8" />
                <circle cx="220" cy="220" r="130" stroke="#F06436" strokeWidth="1.5" strokeDasharray="4 6" />

                {/* Confetti tokens radiating outward */}
                <rect x="180" y="80" width="16" height="16" rx="4" fill="#C6F400" stroke="#171717" strokeWidth="1.5" transform="rotate(25 188 88)" />
                <circle cx="310" cy="120" r="14" fill="#F06436" />
                <polygon points="340,220 360,250 320,250" fill="#3154E8" />
                <rect x="290" y="320" width="20" height="20" rx="5" fill="#C6F400" stroke="#171717" strokeWidth="1.5" transform="rotate(-15 300 330)" />
                <circle cx="160" cy="340" r="16" fill="#F06436" />
                <polygon points="90,290 115,310 75,320" fill="#3154E8" />
                <circle cx="95" cy="180" r="12" fill="#C6F400" stroke="#171717" strokeWidth="1.5" />
                <rect x="120" y="110" width="14" height="14" rx="3" fill="#171717" transform="rotate(45 127 117)" />

                {/* Central festival starburst */}
                <circle cx="220" cy="220" r="36" fill="#FFFFFF" stroke="#171717" strokeWidth="2.5" />
                <circle cx="220" cy="220" r="16" fill="#C6F400" stroke="#171717" strokeWidth="1.5" />
              </g>
            </svg>

            <div className="canvas-footer-status font-mono">
              <span>EXPLORE MODE · PINNED TIMELINE</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
