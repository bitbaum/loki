"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { shouldLeaveExpandedOnKey } from "@/lib/terminal-expand";

const BODY_CLASS = "fc-terminal-fullscreen";

/**
 * Expand/collapse for /terminal, at every width. Normal layout keeps the page
 * in app-viewport-pane (top bar, sidebar or bottom nav). Expanded covers the
 * full screen so xterm gets every row and column — on a phone so the soft
 * keyboard does not crush it, on a laptop so the session is not a box beside
 * the app chrome. Esc leaves it (see below); so does the same button.
 *
 * This component used to own a header row too: a sentence explaining that the
 * default pane is too small on phones, next to the Expand button. Telling the
 * operator the layout is bad, in the space that made it bad, is not a fix — the
 * row is gone and the toggle now lives in TerminalMobileHeader, on the same row
 * as the session name, which is also where a thumb already is.
 */
export function TerminalMobileShell({
  children,
}: {
  children: (opts: { immersive: boolean; toggleImmersive: () => void }) => React.ReactNode;
}) {
  const [immersive, setImmersive] = useState(false);

  useEffect(() => {
    if (!immersive) {
      document.body.classList.remove(BODY_CLASS);
      return;
    }
    document.body.classList.add(BODY_CLASS);
    return () => document.body.classList.remove(BODY_CLASS);
  }, [immersive]);

  // Esc leaves the expanded view — except when the keystroke belongs to
  // something else. Inside the xterm, Esc is a key the agent needs (it
  // interrupts claude, dismisses a TUI menu), so the terminal keeps it; and a
  // handler that already consumed it (a picker, a sheet) wins too.
  useEffect(() => {
    if (!immersive) return;
    const onKey = (e: KeyboardEvent) => {
      if (!shouldLeaveExpandedOnKey(e)) return;
      setImmersive(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [immersive]);

  const toggleImmersive = useCallback(() => setImmersive((v) => !v), []);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col md:gap-3",
        immersive && "ui-term-mobile-fullscreen",
      )}
    >
      {children({ immersive, toggleImmersive })}
    </div>
  );
}
