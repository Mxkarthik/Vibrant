import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

export default function OpportunitySection({ onRegisterClick }: { onRegisterClick: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const headlineBeforeRef = useRef<HTMLHeadingElement>(null);
  const headlineAfterRef = useRef<HTMLHeadingElement>(null);

  const nodeIdeasRef = useRef<SVGGElement>(null);
  const nodeTalentRef = useRef<SVGGElement>(null);
  const nodeCourageRef = useRef<SVGGElement>(null);
  const nodePossibilitiesRef = useRef<SVGGElement>(null);
  const stageRingsRef = useRef<SVGGElement>(null);
  const centralYouRef = useRef<SVGGElement>(null);

  const [hasCompletedConvergence, setHasCompletedConvergence] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !containerRef.current) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top top",
          end: "+=260%",
          pin: true,
          scrub: 0.8,
          onUpdate: (self) => {
            setHasCompletedConvergence(self.progress > 0.65);
          },
        },
      });

      // Initial state
      gsap.set(headlineBeforeRef.current, { opacity: 1, y: 0 });
      gsap.set(headlineAfterRef.current, { opacity: 0, y: 30, filter: "blur(4px)" });

      // 4 Nodes converge from outward corners into center YOU
      // 1. IDEAS (top left)
      tl.fromTo(nodeIdeasRef.current,
        { x: -140, y: -140, opacity: 0, scale: 0.6 },
        { x: 0, y: 0, opacity: 1, scale: 1, duration: 1, ease: "power2.out" },
        0
      );

      // 2. TALENT (top right)
      tl.fromTo(nodeTalentRef.current,
        { x: 140, y: -140, opacity: 0, scale: 0.6 },
        { x: 0, y: 0, opacity: 1, scale: 1, duration: 1, ease: "power2.out" },
        0.3
      );

      // 3. COURAGE (bottom left)
      tl.fromTo(nodeCourageRef.current,
        { x: -140, y: 140, opacity: 0, scale: 0.6 },
        { x: 0, y: 0, opacity: 1, scale: 1, duration: 1, ease: "power2.out" },
        0.6
      );

      // 4. POSSIBILITIES (bottom right)
      tl.fromTo(nodePossibilitiesRef.current,
        { x: 140, y: 140, opacity: 0, scale: 0.6 },
        { x: 0, y: 0, opacity: 1, scale: 1, duration: 1, ease: "power2.out" },
        0.9
      );

      // Stage expansion: As they converge, stage rings radiate and central YOU glows
      tl.fromTo(stageRingsRef.current?.children || [],
        { scale: 0.4, opacity: 0, transformOrigin: "200px 200px" },
        { scale: 1, opacity: 1, stagger: 0.1, duration: 1.2, ease: "back.out(1.4)" },
        1.2
      );

      tl.to(centralYouRef.current, {
        scale: 1.15,
        duration: 0.8,
        transformOrigin: "200px 200px",
        ease: "power2.out",
      }, 1.4);

      // Headline swap: "What if this is your moment?" -> "Don't wait for your moment. Create it."
      tl.to(headlineBeforeRef.current, {
        opacity: 0,
        y: -30,
        filter: "blur(4px)",
        duration: 0.8,
      }, 1.5)
        .to(headlineAfterRef.current, {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          duration: 0.8,
        }, 1.8);

    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} id="opportunity" className="vibrant-opportunity-section" aria-label="The Opportunity">
      <div className="opportunity-container">
        {/* Left Side: Dynamic Question & Transformation */}
        <div className="opportunity-text-col">
          <span className="section-label-badge font-mono">03 / YOUR STAGE</span>

          <div className="opportunity-headlines-wrap">
            <h2 ref={headlineBeforeRef} className="opportunity-headline font-space">
              What if this is <br />
              <span className="accent-orange">your moment?</span>
            </h2>

            <h2 ref={headlineAfterRef} className="opportunity-headline headline-revealed font-space">
              Don&apos;t wait for your moment. <br />
              <span className="accent-orange">Create it.</span>
            </h2>
          </div>

          <p className="opportunity-subtext font-sans">
            The idea you&apos;ve been waiting to share. The talent you&apos;ve been waiting to show. The experience you&apos;ve been waiting to live. This is your chance.
          </p>

          <div className="opportunity-cta-wrap">
            <button
              type="button"
              className="opportunity-register-btn font-sans"
              onClick={onRegisterClick}
            >
              {hasCompletedConvergence ? "Claim Your Stage ↗" : "Register Now ↗"}
            </button>
            <span className="opportunity-footnote font-mono">
              STAGE ACCESS OPEN FOR ALL STUDENTS
            </span>
          </div>
        </div>

        {/* Right Side: Converging Nodes into Central YOU */}
        <div className="opportunity-visual-col">
          <div className="opportunity-stage-canvas">
            <svg
              className="opportunity-svg"
              viewBox="0 0 400 400"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-label="Convergence diagram towards You"
            >
              {/* Radial guides */}
              <circle cx="200" cy="200" r="150" stroke="#E9E9E4" strokeWidth="1" strokeDasharray="4 4" />
              <circle cx="200" cy="200" r="100" stroke="#E9E9E4" strokeWidth="1" />
              <line x1="50" y1="200" x2="350" y2="200" stroke="#E9E9E4" strokeWidth="0.8" />
              <line x1="200" y1="50" x2="200" y2="350" stroke="#E9E9E4" strokeWidth="0.8" />

              {/* Stage Rings revealed when assembled */}
              <g ref={stageRingsRef} className="stage-assembled-rings">
                <circle cx="200" cy="200" r="80" stroke="#F06436" strokeWidth="1.5" strokeOpacity="0.4" />
                <circle cx="200" cy="200" r="64" stroke="#3154E8" strokeWidth="1" strokeOpacity="0.5" strokeDasharray="6 4" />
              </g>

              {/* Node 1: IDEAS (Top-Left) */}
              <g ref={nodeIdeasRef} className="converging-node">
                <circle cx="100" cy="100" r="26" fill="#FFFFFF" stroke="#F06436" strokeWidth="2" filter="drop-shadow(0 4px 12px rgba(0,0,0,0.06))" />
                <text x="100" y="104" textAnchor="middle" fill="#171717" fontSize="9" fontFamily="JetBrains Mono" fontWeight="700">IDEAS</text>
              </g>

              {/* Node 2: TALENT (Top-Right) */}
              <g ref={nodeTalentRef} className="converging-node">
                <circle cx="300" cy="100" r="26" fill="#FFFFFF" stroke="#3154E8" strokeWidth="2" filter="drop-shadow(0 4px 12px rgba(0,0,0,0.06))" />
                <text x="300" y="104" textAnchor="middle" fill="#171717" fontSize="9" fontFamily="JetBrains Mono" fontWeight="700">TALENT</text>
              </g>

              {/* Node 3: COURAGE (Bottom-Left) */}
              <g ref={nodeCourageRef} className="converging-node">
                <circle cx="100" cy="300" r="26" fill="#FFFFFF" stroke="#171717" strokeWidth="2" filter="drop-shadow(0 4px 12px rgba(0,0,0,0.06))" />
                <text x="100" y="304" textAnchor="middle" fill="#171717" fontSize="9" fontFamily="JetBrains Mono" fontWeight="700">COURAGE</text>
              </g>

              {/* Node 4: POSSIBILITIES (Bottom-Right) */}
              <g ref={nodePossibilitiesRef} className="converging-node">
                <circle cx="300" cy="300" r="26" fill="#FFFFFF" stroke="#C6F400" strokeWidth="2" filter="drop-shadow(0 4px 12px rgba(0,0,0,0.06))" />
                <text x="300" y="304" textAnchor="middle" fill="#171717" fontSize="8" fontFamily="JetBrains Mono" fontWeight="700">POSSIBILITIES</text>
              </g>

              {/* Central Focal Element: YOU */}
              <g ref={centralYouRef} className="central-you-group">
                <circle cx="200" cy="200" r="42" fill="#F06436" filter="drop-shadow(0 8px 24px rgba(240,100,54,0.3))" />
                <circle cx="200" cy="200" r="48" stroke="#F06436" strokeWidth="1.5" strokeOpacity="0.4" fill="none" />
                <text x="200" y="206" textAnchor="middle" fill="#FFFFFF" fontSize="16" fontFamily="Space Grotesk" fontWeight="800" letterSpacing="0.05em">YOU</text>
              </g>
            </svg>

            <div className="stage-canvas-status font-mono">
              <span>{hasCompletedConvergence ? "STAGE READY · YOUR POSITION IS CONFIRMED" : "CONVERGING ASSETS · SCROLL TO ASSEMBLE"}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
