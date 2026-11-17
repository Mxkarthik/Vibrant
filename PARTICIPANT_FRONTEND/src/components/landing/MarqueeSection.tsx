import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

export default function MarqueeSection() {
  const marqueeRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !trackRef.current) return;

    // React subtly to scroll velocity
    const trigger = ScrollTrigger.create({
      trigger: marqueeRef.current,
      start: "top bottom",
      end: "bottom top",
      onUpdate: (self) => {
        const velocity = Math.min(Math.max(self.getVelocity() / 300, -3), 3);
        gsap.to(trackRef.current, {
          timeScale: 1 + Math.abs(velocity) * 0.5,
          duration: 0.4,
          overwrite: "auto",
        });
      },
    });

    return () => {
      trigger.kill();
    };
  }, []);

  const marqueeItems = [
    { text: "INNOVATE", className: "text-orange" },
    { text: "•", className: "text-muted" },
    { text: "PERFORM", className: "text-blue" },
    { text: "•", className: "text-muted" },
    { text: "CELEBRATE", className: "text-dark" },
    { text: "•", className: "text-muted" },
    { text: "INNOVATE", className: "text-dark" },
    { text: "•", className: "text-muted" },
    { text: "PERFORM", className: "text-orange" },
    { text: "•", className: "text-muted" },
    { text: "CELEBRATE", className: "text-blue" },
    { text: "•", className: "text-muted" },
  ];

  return (
    <div ref={marqueeRef} className="vibrant-marquee-wrapper" aria-label="Festival Energy Marquee">
      <div ref={trackRef} className="vibrant-marquee-track">
        {/* Set 1 */}
        <div className="vibrant-marquee-content font-space">
          {marqueeItems.map((item, index) => (
            <span key={`m1-${index}`} className={`marquee-item ${item.className}`}>
              {item.text}
            </span>
          ))}
        </div>
        {/* Set 2 (for seamless loop) */}
        <div className="vibrant-marquee-content font-space" aria-hidden="true">
          {marqueeItems.map((item, index) => (
            <span key={`m2-${index}`} className={`marquee-item ${item.className}`}>
              {item.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
