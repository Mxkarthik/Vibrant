import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ToastItem, ToastType } from "./ToastContext";
import "./Toast.css";

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export default function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <aside
      className="vibrant-toast-container"
      aria-label="Notifications"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </aside>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const [paused, setPaused] = useState(false);
  const remainingTimeRef = useRef(toast.duration);
  const lastStartTimeRef = useRef(Date.now());
  const timerRef = useRef<number | null>(null);

  // Setup auto-dismiss with pause on hover capability
  useEffect(() => {
    if (toast.exiting) return;

    if (paused) {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const elapsed = Date.now() - lastStartTimeRef.current;
      remainingTimeRef.current = Math.max(0, remainingTimeRef.current - elapsed);
      return;
    }

    lastStartTimeRef.current = Date.now();
    timerRef.current = window.setTimeout(() => {
      onDismiss(toast.id);
    }, remainingTimeRef.current);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [paused, toast.id, toast.exiting, onDismiss]);

  const isAlert = toast.type === "error" || toast.type === "warning";

  return (
    <div
      className={`vibrant-toast vibrant-toast-${toast.type} ${
        toast.exiting ? "is-exiting" : ""
      } ${paused ? "is-paused" : ""}`}
      role={isAlert ? "alert" : "status"}
      aria-atomic="true"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="vibrant-toast-icon-wrap" aria-hidden="true">
        <ToastIcon type={toast.type} />
      </div>

      <div className="vibrant-toast-body">
        <h4 className="vibrant-toast-title">{toast.title}</h4>
        <p className="vibrant-toast-message">{toast.message}</p>
      </div>

      <button
        type="button"
        className="vibrant-toast-close"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="15"
          height="15"
          aria-hidden="true"
        >
          <line x1="15" y1="5" x2="5" y2="15" />
          <line x1="5" y1="5" x2="15" y2="15" />
        </svg>
      </button>

      {/* Progress Indicator */}
      <div
        className="vibrant-toast-progress"
        style={
          {
            "--toast-duration": `${toast.duration}ms`,
          } as CSSProperties
        }
        aria-hidden="true"
      />
    </div>
  );
}

function ToastIcon({ type }: { type: ToastType }) {
  switch (type) {
    case "error":
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="18"
          height="18"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
    case "warning":
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="18"
          height="18"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case "success":
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="18"
          height="18"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      );
    case "info":
    default:
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="18"
          height="18"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
  }
}
