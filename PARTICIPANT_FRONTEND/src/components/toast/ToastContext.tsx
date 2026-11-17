import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ToastContainer from "./ToastContainer";

export type ToastType = "error" | "warning" | "success" | "info";

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  duration: number;
  createdAt: number;
  exiting?: boolean;
}

export interface ToastOptions {
  id?: string;
  title?: string;
  message: string;
  type?: ToastType;
  duration?: number;
}

export interface ToastContextValue {
  show: (options: ToastOptions) => string;
  error: (message: string, title?: string, options?: Partial<ToastOptions>) => string;
  warning: (message: string, title?: string, options?: Partial<ToastOptions>) => string;
  success: (message: string, title?: string, options?: Partial<ToastOptions>) => string;
  info: (message: string, title?: string, options?: Partial<ToastOptions>) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

const DEFAULT_TITLES: Record<ToastType, string> = {
  error: "Validation Error",
  warning: "Attention Required",
  success: "Action Completed",
  info: "Notice",
};

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  error: 4500,
  warning: 4000,
  success: 3000,
  info: 3500,
};

const MAX_TOASTS = 3;
const DEDUP_WINDOW_MS = 1800;

const ToastContext = createContext<ToastContextValue | null>(null);

let toastCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const recentToastsRef = useRef<Map<string, number>>(new Map());

  // Mark a toast as exiting and remove it after animation
  const dismiss = useCallback((id: string) => {
    setToasts((current) =>
      current.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    );

    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 240);
  }, []);

  const dismissAll = useCallback(() => {
    setToasts((current) => current.map((t) => ({ ...t, exiting: true })));
    window.setTimeout(() => {
      setToasts([]);
    }, 240);
  }, []);

  const show = useCallback(
    ({ id, title, message, type = "info", duration }: ToastOptions): string => {
      const finalTitle = title || DEFAULT_TITLES[type];
      const finalDuration = duration ?? DEFAULT_DURATIONS[type];
      const deduplicationKey = `${type}::${finalTitle}::${message.trim()}`;
      const now = Date.now();

      // Check if identical toast was shown very recently
      const lastShown = recentToastsRef.current.get(deduplicationKey);
      if (lastShown && now - lastShown < DEDUP_WINDOW_MS) {
        // Return existing ID without spamming a duplicate notification
        return id || `toast-debounced-${now}`;
      }

      recentToastsRef.current.set(deduplicationKey, now);

      // Clean up old entries in recentToastsRef
      if (recentToastsRef.current.size > 20) {
        for (const [key, timestamp] of recentToastsRef.current.entries()) {
          if (now - timestamp > 5000) {
            recentToastsRef.current.delete(key);
          }
        }
      }

      const toastId = id || `toast-${++toastCounter}-${now}`;

      const newToast: ToastItem = {
        id: toastId,
        type,
        title: finalTitle,
        message,
        duration: finalDuration,
        createdAt: now,
        exiting: false,
      };

      setToasts((current) => {
        // Avoid duplicate ID if explicitly passed
        const filtered = current.filter((t) => t.id !== toastId && !t.exiting);
        // Keep at most MAX_TOASTS - 1 to make room
        const trimmed = filtered.length >= MAX_TOASTS ? filtered.slice(filtered.length - (MAX_TOASTS - 1)) : filtered;
        return [...trimmed, newToast];
      });

      return toastId;
    },
    []
  );

  const error = useCallback(
    (message: string, title?: string, options?: Partial<ToastOptions>) =>
      show({ message, title: title || "Validation Error", type: "error", ...options }),
    [show]
  );

  const warning = useCallback(
    (message: string, title?: string, options?: Partial<ToastOptions>) =>
      show({ message, title: title || "Attention Required", type: "warning", ...options }),
    [show]
  );

  const success = useCallback(
    (message: string, title?: string, options?: Partial<ToastOptions>) =>
      show({ message, title: title || "Success", type: "success", ...options }),
    [show]
  );

  const info = useCallback(
    (message: string, title?: string, options?: Partial<ToastOptions>) =>
      show({ message, title: title || "Notice", type: "info", ...options }),
    [show]
  );

  const value: ToastContextValue = {
    show,
    error,
    warning,
    success,
    info,
    dismiss,
    dismissAll,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
