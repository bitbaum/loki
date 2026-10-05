"use client";

import { useEffect, useState, type MutableRefObject } from "react";
import {
  SUGGESTION_WINDOW_ROWS,
  sameSuggestions,
  suggestPrompts,
} from "@/lib/terminal-suggestions";

/** How often the screen is re-read while the Prompt box is showing. */
const POLL_MS = 4_000;

/**
 * Prompts that fit what the attached session's screen shows right now.
 * Reads the rendered screen (TerminalView's readScreenRef) on a slow poll only
 * while `enabled` — the screen is cheap to read, but there is no reason to read
 * it while nothing would show the result.
 */
export function useScreenSuggestions(
  readScreenRef: MutableRefObject<((rows: number) => string[]) | null>,
  enabled: boolean,
): string[] {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const read = () => {
      const next = suggestPrompts(readScreenRef.current?.(SUGGESTION_WINDOW_ROWS) ?? []);
      setSuggestions((prev) => (sameSuggestions(prev, next) ? prev : next));
    };
    const first = window.setTimeout(read, 0);
    const t = window.setInterval(read, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [readScreenRef, enabled]);
  return suggestions;
}
