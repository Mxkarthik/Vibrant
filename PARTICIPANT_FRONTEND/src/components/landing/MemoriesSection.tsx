import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

export default function MemoriesSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const phrasesWrapRef = useRef<HTMLDivElement>(null);
  const photosWrapRef = useRef<HTMLDivElement>(null);
  const decisionStatementRef = useRef<HTMLDivElement>(null);

  const [activePhraseIndex, setActivePhraseIndex] = useState(0);

  const memories = [
    { phrase: "New faces.", context: "Meeting across departments, clubs, and year groups." },
    { phrase: "Shared victories.", context: "The cheers when your teammates solve the impossible bug." },
    { phrase: "Unexpected friendships.", context: "Bonding behind the stage curtains and in project labs." },
    { phrase: "Unforgettable moments.", context: "The feeling of thousands celebrating together under campus lights." },
  ];

  const photos = [
    { src: "/images/diet/cultural-celebration.webp", alt: "Cultural celebration at DIET", caption: "ON STAGE · CELEBRATION" },
    { src: "/images/diet/innovation-challenge.webp", alt: "Technical innovation challenge", caption: "TEAMWORK · LABS" },
    { src: "/images/diet/vibrant-annual-day.webp", alt: "Annual Day student gathering", caption: "COMMUNITY · MEMORIES" },
  ];

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !containerRef.current) return;

    const ctx = gsap.context(() => {
      const phraseElements = Array.from(phrasesWrapRef.current?.children || []) as HTMLElement[];
      const photoElements = Array.from(photosWrapRef.current?.children || []) as HTMLElement[];

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top top",
          end: "+=280%",
          pin: true,
          scrub: 0.8,
          onUpdate: (self) => {
            const index = Math.min(Math.floor(self.progress * memories.length), memories.length - 1);
            setActivePhraseIndex(index);
          },
        },
      });

      // Sequential reveals for phrases and photos
      phraseElements.forEach((el, i) => {
        if (i === 0) {
          gsap.set(el, { opacity: 1, y: 0 });
        } else {
          gsap.set(el, { opacity: 0, y: 35 });
        }
      });

      photoElements.forEach((el, i) => {
        if (i === 0) {
          gsap.set(el, { opacity: 1, scale: 1 });
        } else {
          gsap.set(el, { opacity: 0, scale: 0.94 });
        }
      });

      gsap.set(decisionStatementRef.current, { opacity: 0, y: 40, filter: "blur(4px)" });

      // Step through phrases and corresponding photos
      memories.forEach((_, i) => {
        if (i < memories.length - 1) {
          tl.to(phraseElements[i], { opacity: 0, y: -25, duration: 0.8 }, `+=0.2`)
            .to(phraseElements[i + 1], { opacity: 1, y: 0, duration: 0.8 }, `-=0.4`);

          if (photoElements[i] && photoElements[i + 1]) {
            tl.to(photoElements[i], { opacity: 0, scale: 1.04, duration: 0.8 }, `-=0.8`)
              .to(photoElements[i + 1], { opacity: 1, scale: 1, duration: 0.8 }, `-=0.4`);
          }
        }
      });

      // Final decision statement
      tl.to([phraseElements[memories.length - 1], photosWrapRef.current], {
        opacity: 0,
        y: -30,
        duration: 0.8,
      }, "+=0.3")
        .to(decisionStatementRef.current, {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          duration: 1.2,
          ease: "power2.out",
        }, "-=0.2");

    }, containerRef);

    return () => ctx.revert();
  }, [memories.length]);

  return (
    <section ref={containerRef} id="memories" className="vibrant-memories-section" aria-label="Beyond the Event">
      <div className="memories-container">
        {/* Left Column: Phrases & Narrative */}
        <div className="memories-text-col">
          <span className="section-label-badge font-mono">05 / THE MEMORIES</span>

          <h2 className="memories-main-headline font-space">
            The events will end. <br />
            <span className="accent-orange">The memories won&apos;t.</span>
          </h2>

          <p className="memories-subtext font-sans">
            The friendships you didn&apos;t expect. The challenges you overcame. The moments you laughed a little louder. The stories you&apos;ll tell long after college. That&apos;s what makes VIBRANT different.
          </p>

          <div ref={phrasesWrapRef} className="memories-phrases-viewport font-space">
            {memories.map((m, index) => (
              <div
                key={m.phrase}
                className={`memory-phrase-item ${activePhraseIndex === index ? "is-active" : ""}`}
              >
                <span className="phrase-number font-mono">0{index + 1} / 04</span>
                <h3 className="phrase-text">{m.phrase}</h3>
                <p className="phrase-context font-sans">{m.context}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Genuine Photos Frame */}
        <div className="memories-photo-col">
          <div className="memories-photo-frame">
            <div className="photo-frame-border" />
            <div ref={photosWrapRef} className="photos-stack">
              {photos.map((photo, index) => (
                <div key={photo.src} className={`photo-slide slide-${index}`}>
                  <img src={photo.src} alt={photo.alt} loading="lazy" />
                  <div className="photo-slide-caption font-mono">
                    <span>{photo.caption}</span>
                    <span>DIET CAMPUS ARCHIVES</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Transition statement */}
      <div ref={decisionStatementRef} className="memories-decision-statement">
        <p className="decision-quote font-space">
          &ldquo;Every great memory begins with a decision.&rdquo;
        </p>
        <span className="decision-cue font-mono">STEP FORWARD INTO YOUR CHAPTER</span>
      </div>
    </section>
  );
}
