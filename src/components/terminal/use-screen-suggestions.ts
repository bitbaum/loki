"use client";

import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { SUGGESTION_WINDOW_ROWS, suggestPrompts } from "@/lib/terminal-suggestions";
import { useAiNextSteps } from "@/hooks/use-ai-next-steps";
import { useStableSteps } from "@/hooks/use-stable-steps";

/** How often the screen is re-read. Two equal reads in a row = settled. */
const POLL_MS = 3_000;

/**
 * Next steps that fit what the attached session's screen shows, chosen once
 * the screen has settled (two equal reads) and then held still
 * (useStableSteps). A screen that is still scrolling never reaches the model
 * and never reshuffles the chips.
 */
export function useScreenSuggestions(
  readScreenRef: MutableRefObject<((rows: number) => string[]) | null>,
  enabled: boolean,
  project: string | null,
  hold = false,
): string[] {
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let previous: string | null = null;
    const read = () => {
      const lines = readScreenRef.current?.(SUGGESTION_WINDOW_ROWS) ?? [];
      const text = lines.join("\n").trim();
      if (text && text === previous) setSettled((s) => (s === text ? s : text));
      previous = text;
    };
    const first = window.setTimeout(read, 0);
    const t = window.setInterval(read, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [readScreenRef, enabled]);
  const key = enabled ? settled : null;
  const rules = useMemo(() => (key ? suggestPrompts(key.split("\n")) : []), [key]);
  const ai = useAiNextSteps(key, "screen", project);
  return useStableSteps(key, ai, rules, hold);
}
