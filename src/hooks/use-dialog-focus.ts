"use client";

import { useEffect, useRef } from "react";

/** Shared modal/drawer focus: enter, contain Tab, then return to the opener. */
export function useDialogFocus() {
  const ref = useRef<HTMLDivElement>(null);
  // Capture before descendants mount: an autofocus input may already have
  // moved focus inside the dialog by the time effects run.
  const opener = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const previous = opener.current;
    const targets = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button, input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.hasAttribute("disabled") &&
          !element.closest("[hidden], [inert]") &&
          element.getClientRects().length > 0,
      );
    if (!panel.contains(document.activeElement)) (targets()[0] ?? panel).focus();
    const contain = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = targets();
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === panel)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener("keydown", contain);
    return () => {
      panel.removeEventListener("keydown", contain);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return ref;
}
