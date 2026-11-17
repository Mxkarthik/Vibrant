import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

export default function StorySection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftColRef = useRef<HTMLDivElement>(null);
  const rightColRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  // SVG Elements
  const centerCircleRef = useRef<SVGCircleElement>(null);
  const pulseRingRef = useRef<SVGCircleElement>(null);
  const outerShapesRef = useRef<SVGGElement>(null);
  const connectLinesRef = useRef<SVGGElement>(null);
  const constellationRef = useRef<SVGGElement>(null);

  const [currentStage, setCurrentStage] = useState(1);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !containerRef.current) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top top",
          end: "+=220%",
          pin: true,
          scrub: 0.8,
          onUpdate: (self) => {
            const p = self.progress;
            if (progressBarRef.current) {
              progressBarRef.current.style.transform = `scaleX(${p})`;
            }
            if (p < 0.35) {
              setCurrentStage(1);
            } else if (p < 0.7) {
              setCurrentStage(2);
            } else {
              setCurrentStage(3);
            }
          },
        },
      });

      // Stage 1 -> 2: Circle expands and outer shapes appear
      tl.to(centerCircleRef.current, {
        attr: { r: 38 },
        fill: "#F06436",
        duration: 1,
        ease: "power2.inOut",
      }, 0);

      tl.to(pulseRingRef.current, {
        attr: { r: 64 },
        opacity: 0.7,
        duration: 1,
        ease: "power2.out",
      }, 0.2);

      tl.fromTo(
        outerShapesRef.current?.children || [],
        { scale: 0, opacity: 0, transformOrigin: "center center" },
        { scale: 1, opacity: 1, stagger: 0.08, duration: 1, ease: "back.out(1.6)" },
        0.3
      );

      // Stage 2 -> 3: Connecting lines appear and form vibrant festival constellation
      tl.fromTo(
        connectLinesRef.current?.children || [],
        { strokeDashoffset: 100, opacity: 0 },
        { strokeDashoffset: 0, opacity: 1, stagger: 0.06, duration: 1, ease: "power2.out" },
        1.2
      );

      tl.fromTo(
        constellationRef.current?.children || [],
        { scale: 0, opacity: 0, transformOrigin: "center center" },
        { scale: 1, opacity: 1, stagger: 0.05, duration: 0.9, ease: "power2.out" },
        1.4
      );

      // Section Exit blur
      tl.to([leftColRef.current, rightColRef.current], {
        filter: "blur(3px)",
        opacity: 0.15,
        y: -30,
        duration: 0.6,
        ease: "power1.in",
      }, 2.4);

    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} id="story" className="vibrant-story-section" aria-label="Beyond the Ordinary">
      <div className="story-container">
        {/* Left Column: Narrative */}
        <div ref={leftColRef} className="story-narrative-col">
          <div className="story-header-meta">
            <span className="section-label-badge font-mono">01 / BEYOND THE ORDINARY</span>
            <div className="story-stage-indicator font-mono">
              STAGE 0{currentStage} <span className="text-muted">/ 03</span>
            </div>
          </div>

          <div className="story-progress-track">
            <div ref={progressBarRef} className="story-progress-bar" />
          </div>

          <div className="story-text-body">
            <h2 className="story-main-headline font-space">
              Some days become memories. <br />
              <span className="accent-orange">This is one of them.</span>
            </h2>

            <p className="story-body-copy font-sans">
              College life is more than classrooms, assignments, and deadlines. It&apos;s about discovering what you&apos;re capable of, meeting people who share your energy, and creating moments that stay with you.
            </p>

            <p className="story-highlight-quote font-space">
              VIBRANT is where all of that comes together.
            </p>

            <div className={`story-conclusion-callout font-mono ${currentStage === 3 ? "is-visible" : ""}`}>
              <span className="callout-symbol">✦</span>
              <span>One campus. Infinite possibilities.</span>
            </div>
          </div>
        </div>

        {/* Right Column: Animated SVG Composition */}
        <div ref={rightColRef} className="story-visual-col">
          <div className="story-svg-frame">
            {/* Subtle internal grid */}
            <div className="story-frame-grid" />
            <div className="story-frame-header font-mono">
              <span>CANVAS · COORD [01.26]</span>
              <span className="status-live">● ACTIVE PHASE</span>
            </div>

            <svg
              className="story-svg-canvas"
              viewBox="0 0 400 400"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-label="Story progression diagram"
            >
              {/* Background circular guide grid */}
              <circle cx="200" cy="200" r="140" stroke="#E9E9E4" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx="200" cy="200" r="90" stroke="#E9E9E4" strokeWidth="1" />

              {/* Connecting lines for Stage 3 */}
              <g ref={connectLinesRef} className="svg-connections">
                <line x1="200" y1="200" x2="110" y2="120" stroke="#3154E8" strokeWidth="1.5" strokeDasharray="100" />
                <line x1="200" y1="200" x2="290" y2="110" stroke="#F06436" strokeWidth="1.5" strokeDasharray="100" />
                <line x1="200" y1="200" x2="310" y2="280" stroke="#3154E8" strokeWidth="1.5" strokeDasharray="100" />
                <line x1="200" y1="200" x2="100" y2="270" stroke="#F06436" strokeWidth="1.5" strokeDasharray="100" />
                <line x1="110" y1="120" x2="290" y2="110" stroke="#E5E5E5" strokeWidth="1" strokeDasharray="100" />
                <line x1="290" y1="110" x2="310" y2="280" stroke="#E5E5E5" strokeWidth="1" strokeDasharray="100" />
                <line x1="310" y1="280" x2="100" y2="270" stroke="#E5E5E5" strokeWidth="1" strokeDasharray="100" />
                <line x1="100" y1="270" x2="110" y2="120" stroke="#E5E5E5" strokeWidth="1" strokeDasharray="100" />
              </g>

              {/* Outer Shapes for Stage 2 */}
              <g ref={outerShapesRef} className="svg-outer-shapes">
                {/* Top Left - Innovation node */}
                <rect x="95" y="105" width="30" height="30" rx="6" fill="#FFFFFF" stroke="#3154E8" strokeWidth="2" />
                <circle cx="110" cy="120" r="4" fill="#3154E8" />

                {/* Top Right - Cultural node */}
                <circle cx="290" cy="110" r="16" fill="#FFFFFF" stroke="#F06436" strokeWidth="2" />
                <circle cx="290" cy="110" r="5" fill="#F06436" />

                {/* Bottom Right - Fun node */}
                <polygon points="310,265 325,290 295,290" fill="#FFFFFF" stroke="#3154E8" strokeWidth="2" />

                {/* Bottom Left - Workshop node */}
                <rect x="85" y="255" width="30" height="30" rx="15" fill="#FFFFFF" stroke="#F06436" strokeWidth="2" />
                <circle cx="100" cy="270" r="5" fill="#F06436" />
              </g>

              {/* Constellation sparkle particles for Stage 3 */}
              <g ref={constellationRef} className="svg-constellation">
                <circle cx="200" cy="80" r="3" fill="#F06436" />
                <circle cx="340" cy="190" r="3" fill="#3154E8" />
                <circle cx="200" cy="320" r="3" fill="#C6F400" />
                <circle cx="60" cy="190" r="3" fill="#F06436" />
                <path d="M200,60 L203,68 L211,70 L203,72 L200,80 L197,72 L189,70 L197,68 Z" fill="#F06436" opacity="0.8" />
                <path d="M330,175 L332,180 L337,181 L332,182 L330,187 L328,182 L323,181 L328,180 Z" fill="#3154E8" opacity="0.8" />
              </g>

              {/* Pulse rings around center */}
              <circle ref={pulseRingRef} cx="200" cy="200" r="30" stroke="#F06436" strokeWidth="1.5" opacity="0.3" fill="none" />

              {/* Center Circle representing the Ordinary Moment that expands */}
              <circle
                ref={centerCircleRef}
                cx="200"
                cy="200"
                r="18"
                fill="#171717"
                stroke="#FFFFFF"
                strokeWidth="2"
              />
            </svg>

            <div className="story-frame-footer font-mono">
              <span>{currentStage === 1 ? "PHASE 1: THE ORDINARY MOMENT" : currentStage === 2 ? "PHASE 2: THE EXPANSION OF ENERGY" : "PHASE 3: THE VIBRANT CONSTELLATION"}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
