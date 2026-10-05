"use client";

import { useEffect, useState, type MutableRefObject } from "react";
import {
  SUGGESTION_WINDOW_ROWS,
  sameSuggestions,
  suggestPrompts,
} from "@/lib/terminal-suggestions";
import { mergeSteps } from "@/lib/terminal-next-steps";
import { useAiNextSteps } from "@/hooks/use-ai-next-steps";

/** How often the screen is re-read while the Prompt box is showing. */
const POLL_MS = 4_000;

/**
 * Prompts that fit what the attached session's screen shows right now.
 * Reads the rendered screen (TerminalView's readScreenRef) on a slow poll only
 * while `enabled` — the screen is cheap to read, but there is no reason to read
 * it while nothing would show the result.
 *
 * The rules answer at once; once the screen holds still, the fast model reads
 * it and its steps lead the row (useAiNextSteps). A screen that is still
 * scrolling never reaches the model.
 */
export function useScreenSuggestions(
  readScreenRef: MutableRefObject<((rows: number) => string[]) | null>,
  enabled: boolean,
  project: string | null,
): string[] {
  const [rules, setRules] = useState<string[]>([]);
  const [screen, setScreen] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const read = () => {
      const lines = readScreenRef.current?.(SUGGESTION_WINDOW_ROWS) ?? [];
      const next = suggestPrompts(lines);
      setRules((prev) => (sameSuggestions(prev, next) ? prev : next));
      const text = lines.join("\n").trim();
      setScreen(text || null);
    };
    const first = window.setTimeout(read, 0);
    const t = window.setInterval(read, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [readScreenRef, enabled]);
  const ai = useAiNextSteps(enabled ? screen : null, "screen", project);
  return mergeSteps(ai, rules);
}
