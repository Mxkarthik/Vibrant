import { useEffect, useState } from "react";

const PHRASES = ["Different People", "Different Dreams", "One Celebration"] as const;
const PHRASE_TIMES = [0, 2000, 4000] as const;

export default function IntroExperience({ onComplete }: { onComplete: () => void }) {
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    const phraseTimers = PHRASE_TIMES.map((time, index) =>
      window.setTimeout(() => setPhraseIndex(index), time),
    );
    const completionTimer = window.setTimeout(onComplete, 6000);

    return () => {
      phraseTimers.forEach(window.clearTimeout);
      window.clearTimeout(completionTimer);
    };
  }, [onComplete]);

  return (
    <main className="intro-screen" aria-label="VIBRANT2K26 opening experience">
      <div className="intro-content">
        <h1 className="intro-brand">VIBRANT2K26</h1>
        <div className="intro-progress" role="progressbar" aria-label="Intro progress" aria-valuemin={0} aria-valuemax={100}>
          <span />
        </div>
        <div className="intro-phrase-slot" aria-live="polite" aria-atomic="true">
          {PHRASES.map((phrase, index) => (
            <p
              key={phrase}
              className={`intro-phrase${phraseIndex === index ? " is-current" : ""}`}
              aria-hidden={phraseIndex !== index}
            >
              {phrase}
            </p>
          ))}
        </div>
      </div>
    </main>
  );
}
