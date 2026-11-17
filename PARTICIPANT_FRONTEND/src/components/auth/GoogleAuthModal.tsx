import { useEffect, useRef, useState } from "react";
import { GOOGLE_AUTH_PARTICIPANT_URL } from "../../api/client";

export default function GoogleAuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(open);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const timer = window.setTimeout(() => setMounted(false), 220);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.requestAnimationFrame(() => closeRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button, a[href]"))
        .filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus();
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div className={`auth-backdrop${open ? "" : " is-closing"}`} onMouseDown={(event) => { if (event.target === event.currentTarget && open) onClose(); }}>
      <div
        ref={dialogRef}
        className="auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        aria-describedby="auth-description auth-privacy"
      >
        <button ref={closeRef} className="auth-close" type="button" aria-label="Close sign-in dialog" onClick={onClose}><span /><span /></button>
        <div className="auth-brand">VIBRANT<span>2K26</span></div>
        <p className="auth-kicker">PARTICIPANT REGISTRATION</p>
        <h2 id="auth-title">Your journey starts here.</h2>
        <p id="auth-description" className="auth-description">Continue to register for the celebration.</p>
        <a className="google-signin" href={GOOGLE_AUTH_PARTICIPANT_URL}>
          <GoogleMark /> Continue with Google <span aria-hidden="true">↗</span>
        </a>
        <p id="auth-privacy" className="auth-privacy">Google authentication helps us identify your participant account securely. VIBRANT never receives your Google password.</p>
        <div className="auth-modal-footer"><span>DIET · ANAKAPALLE</span><span>SECURE GOOGLE SIGN-IN</span></div>
      </div>
    </div>
  );
}

function GoogleMark() {
  return <svg viewBox="0 0 48 48" aria-hidden="true" className="google-mark"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.89c-.58 2.96-2.25 5.48-4.73 7.18l7.64 5.93c4.46-4.13 7.18-10.21 7.18-17.58Z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.89.93 7.58 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.47 0 11.91-2.13 15.88-5.87l-7.64-5.93c-2.12 1.42-4.84 2.26-8.24 2.26-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>;
}
