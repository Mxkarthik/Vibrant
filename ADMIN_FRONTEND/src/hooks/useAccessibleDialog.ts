import { useEffect, useRef, type RefObject } from "react";

const openDialogs: HTMLElement[] = [];
const previousDialogState = new WeakMap<HTMLElement, { inert: boolean; ariaHidden: string | null }>();
let bodyLockCount = 0;
let originalBodyOverflow = "";

/** Keeps a mounted modal or drawer keyboard accessible, scroll locked and correctly stacked. */
export function useAccessibleDialog(onDismiss?: () => void, preventDismiss = false, enabled = true): RefObject<HTMLElement> {
  const dialogRef = useRef<HTMLElement>(null);
  const dismissRef = useRef(onDismiss);
  const preventDismissRef = useRef(preventDismiss);
  dismissRef.current = onDismiss;
  preventDismissRef.current = preventDismiss;

  useEffect(() => {
    if (!enabled) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (bodyLockCount === 0) originalBodyOverflow = document.body.style.overflow;
    bodyLockCount += 1;
    document.body.style.overflow = "hidden";
    if (!dialog.hasAttribute("tabindex")) dialog.tabIndex = -1;
    const previousTop = openDialogs[openDialogs.length - 1];
    if (previousTop) {
      previousDialogState.set(previousTop, {
        inert: previousTop.inert,
        ariaHidden: previousTop.getAttribute("aria-hidden")
      });
      previousTop.inert = true;
      previousTop.setAttribute("aria-hidden", "true");
    }
    openDialogs.push(dialog);

    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'
    )).filter(element => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");

    const first = focusables()[0];
    (first || dialog).focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== dialog) return;
      if (event.key === "Escape") {
        if (dismissRef.current && !preventDismissRef.current) {
          event.preventDefault();
          dismissRef.current();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && (document.activeElement === items[0] || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (!event.shiftKey && (document.activeElement === items[items.length - 1] || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        items[0].focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const index = openDialogs.lastIndexOf(dialog);
      if (index >= 0) openDialogs.splice(index, 1);
      const activeDialog = openDialogs[openDialogs.length - 1];
      if (activeDialog) {
        const savedState = previousDialogState.get(activeDialog);
        activeDialog.inert = savedState?.inert ?? false;
        if (savedState?.ariaHidden === null || savedState?.ariaHidden === undefined) activeDialog.removeAttribute("aria-hidden");
        else activeDialog.setAttribute("aria-hidden", savedState.ariaHidden);
        previousDialogState.delete(activeDialog);
      }
      bodyLockCount = Math.max(0, bodyLockCount - 1);
      if (bodyLockCount === 0) document.body.style.overflow = originalBodyOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [enabled]);

  return dialogRef;
}
