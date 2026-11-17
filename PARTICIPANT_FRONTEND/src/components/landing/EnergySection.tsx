import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const stages = [
  { num: "01", text: "CREATE.", color: "#171717", accent: "#F06436", tag: "IGNITE NEW CONCEPTS" },
  { num: "02", text: "COMPETE.", color: "#F06436", accent: "#171717", tag: "TEST YOUR BOUNDARIES" },
  { num: "03", text: "PERFORM.", color: "#3154E8", accent: "#F06436", tag: "OWN THE STAGE" },
  { num: "04", text: "CONNECT.", color: "#171717", accent: "#C6F400", tag: "FIND YOUR PEOPLE" },
  { num: "05", text: "CELEBRATE.", color: "#F06436", accent: "#3154E8", tag: "LIVE THE MOMENT" },
];

export default function EnergySection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wordsWrapRef = useRef<HTMLDivElement>(null);
  const conclusionRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLSpanElement>(null);
  const stageCardsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!containerRef.current || !wordsWrapRef.current) return;

    const cards = stageCardsRef.current.filter(Boolean) as HTMLDivElement[];

    const ctx = gsap.context(() => {
      if (reducedMotion) {
        cards.forEach((el) => {
          gsap.set(el, { autoAlpha: 1, y: 0, scale: 1, filter: "none" });
        });
        if (conclusionRef.current) {
          gsap.set(conclusionRef.current, { autoAlpha: 1, y: 0, filter: "none" });
        }
        return;
      }

      // Initial state: Stage 0 (CREATE) is visible; all subsequent stages and conclusion are strictly hidden
      cards.forEach((el, i) => {
        if (i === 0) {
          gsap.set(el, { autoAlpha: 1, y: 0, scale: 1, filter: "blur(0px)" });
        } else {
          gsap.set(el, { autoAlpha: 0, y: 35, scale: 0.97, filter: "blur(4px)" });
        }
      });
      if (conclusionRef.current) {
        gsap.set(conclusionRef.current, { autoAlpha: 0, y: 30, filter: "blur(4px)" });
      }

      // Single Master Timeline for Section 04: THE ENERGY
      // Strict sequence: ENTER -> HOLD -> EXIT -> NEXT STAGE
      // Each stage exits completely (autoAlpha: 0) BEFORE the next stage begins entering.
      // At no point are two words visibly layered over each other.
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top top",
          end: "+=320%",
          pin: true,
          pinSpacing: true,
          scrub: 0.8,
          invalidateOnRefresh: true,
          onLeaveBack: () => {
            if (cards[0]) {
              gsap.set(cards[0], { autoAlpha: 1, y: 0, scale: 1, filter: "blur(0px)" });
            }
            for (let i = 1; i < cards.length; i++) {
              if (cards[i]) {
                gsap.set(cards[i], { autoAlpha: 0, y: 35, scale: 0.97, filter: "blur(4px)" });
              }
            }
            if (conclusionRef.current) {
              gsap.set(conclusionRef.current, { autoAlpha: 0, y: 30, filter: "blur(4px)" });
            }
            if (meterRef.current) {
              meterRef.current.textContent = `PULSE: MAXIMUM · ${stages[0].tag}`;
            }
          },
          onUpdate: (self) => {
            if (!meterRef.current) return;
            const p = self.progress;

            // Enforce clean state when at the top of the section
            if (p <= 0.005) {
              if (cards[0]) {
                gsap.set(cards[0], { autoAlpha: 1, y: 0, scale: 1, filter: "blur(0px)" });
              }
              for (let i = 1; i < cards.length; i++) {
                if (cards[i]) {
                  gsap.set(cards[i], { autoAlpha: 0, y: 35, scale: 0.97, filter: "blur(4px)" });
                }
              }
              if (conclusionRef.current) {
                gsap.set(conclusionRef.current, { autoAlpha: 0, y: 30, filter: "blur(4px)" });
              }
            }

            // Update meter text in sync with timeline progression without React re-render
            let tag = stages[0].tag;
            if (p > 0.86) {
              tag = "CAMPUS PULSE";
            } else if (p > 0.68) {
              tag = stages[4].tag;
            } else if (p > 0.49) {
              tag = stages[3].tag;
            } else if (p > 0.31) {
              tag = stages[2].tag;
            } else if (p > 0.13) {
              tag = stages[1].tag;
            } else {
              tag = stages[0].tag;
            }
            meterRef.current.textContent = `PULSE: MAXIMUM · ${tag}`;
          },
        },
      });

      // Stage 0: CREATE.
      // 0.0 - 1.2: Hold in center
      // 1.2 - 2.0: Exit smoothly (opacity 1 -> 0, y: 0 -> -35px, blur: 0 -> 4px)
      tl.to(
        cards[0],
        {
          autoAlpha: 0,
          y: -35,
          filter: "blur(4px)",
          scale: 1.03,
          duration: 0.8,
          ease: "power2.in",
        },
        1.2
      );

      // Stage 1: COMPETE.
      // 2.0 - 2.8: Enter (starts strictly at 2.0s AFTER Stage 0 is fully invisible)
      // 2.8 - 4.0: Hold
      // 4.0 - 4.8: Exit
      tl.fromTo(
        cards[1],
        { autoAlpha: 0, y: 35, filter: "blur(4px)", scale: 0.97 },
        { autoAlpha: 1, y: 0, filter: "blur(0px)", scale: 1, duration: 0.8, ease: "power2.out" },
        2.0
      ).to(
        cards[1],
        {
          autoAlpha: 0,
          y: -35,
          filter: "blur(4px)",
          scale: 1.03,
          duration: 0.8,
          ease: "power2.in",
        },
        4.0
      );

      // Stage 2: PERFORM.
      // 4.8 - 5.6: Enter (starts strictly at 4.8s AFTER Stage 1 is fully invisible)
      // 5.6 - 6.8: Hold
      // 6.8 - 7.6: Exit
      tl.fromTo(
        cards[2],
        { autoAlpha: 0, y: 35, filter: "blur(4px)", scale: 0.97 },
        { autoAlpha: 1, y: 0, filter: "blur(0px)", scale: 1, duration: 0.8, ease: "power2.out" },
        4.8
      ).to(
        cards[2],
        {
          autoAlpha: 0,
          y: -35,
          filter: "blur(4px)",
          scale: 1.03,
          duration: 0.8,
          ease: "power2.in",
        },
        6.8
      );

      // Stage 3: CONNECT.
      // 7.6 - 8.4: Enter (starts strictly at 7.6s AFTER Stage 2 is fully invisible)
      // 8.4 - 9.6: Hold
      // 9.6 - 10.4: Exit
      tl.fromTo(
        cards[3],
        { autoAlpha: 0, y: 35, filter: "blur(4px)", scale: 0.97 },
        { autoAlpha: 1, y: 0, filter: "blur(0px)", scale: 1, duration: 0.8, ease: "power2.out" },
        7.6
      ).to(
        cards[3],
        {
          autoAlpha: 0,
          y: -35,
          filter: "blur(4px)",
          scale: 1.03,
          duration: 0.8,
          ease: "power2.in",
        },
        9.6
      );

      // Stage 4: CELEBRATE.
      // 10.4 - 11.2: Enter (starts strictly at 10.4s AFTER Stage 3 is fully invisible)
      // 11.2 - 12.4: Hold
      // 12.4 - 13.2: Exit
      tl.fromTo(
        cards[4],
        { autoAlpha: 0, y: 35, filter: "blur(4px)", scale: 0.97 },
        { autoAlpha: 1, y: 0, filter: "blur(0px)", scale: 1, duration: 0.8, ease: "power2.out" },
        10.4
      ).to(
        cards[4],
        {
          autoAlpha: 0,
          y: -35,
          filter: "blur(4px)",
          scale: 1.03,
          duration: 0.8,
          ease: "power2.in",
        },
        12.4
      );

      // Conclusion Statement
      // 13.2 - 14.2: Enter (starts strictly at 13.2s AFTER Stage 4 is fully invisible)
      // 14.2 - 15.4: Hold
      if (conclusionRef.current) {
        tl.fromTo(
          conclusionRef.current,
          { autoAlpha: 0, y: 30, filter: "blur(4px)" },
          { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 1.0, ease: "power2.out" },
          13.2
        );
      }
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} id="energy" className="vibrant-energy-section" aria-label="The Energy">
      <div className="energy-header font-mono">
        <span className="section-label-badge">04 / THE ENERGY</span>
        <span ref={meterRef} className="energy-meter-reading">
          PULSE: MAXIMUM · {stages[0].tag}
        </span>
      </div>

      <div className="energy-lead-wrap">
        <p className="energy-kicker font-space">
          Less ordinary. <span className="accent-orange">More ALIVE.</span>
        </p>
      </div>

      {/* Full-width typography stage */}
      <div ref={wordsWrapRef} className="energy-words-stage font-space">
        {stages.map((stage, index) => (
          <div
            key={stage.text}
            ref={(el) => {
              stageCardsRef.current[index] = el;
            }}
            className="energy-word-card"
            style={{ color: stage.color }}
          >
            <span className="word-index-tag font-mono">{stage.num}</span>
            <span className="word-text-monumental">{stage.text}</span>
            <span className="word-sub-tag font-mono">{stage.tag}</span>
          </div>
        ))}
      </div>

      {/* Final Statement revealed after words complete */}
      <div ref={conclusionRef} className="energy-conclusion-statement">
        <h3 className="conclusion-headline font-space">
          You don&apos;t just attend VIBRANT. <br />
          <span className="accent-orange">You feel it.</span>
        </h3>
        <p className="conclusion-footnote font-mono">
          THE HIGH-VOLTAGE CELEBRATION OF DADI INSTITUTE OF ENGINEERING &amp; TECHNOLOGY
        </p>
      </div>
    </section>
  );
}
