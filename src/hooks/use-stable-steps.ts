"use client";

import { useEffect, useState } from "react";
import { nextShownSteps, visibleSteps, type ShownSteps } from "@/lib/stable-steps";

/** How long to wait for the fast model before showing the rule-based steps. */
const FALLBACK_MS = 9_000;

/**
 * Suggested next steps that hold still long enough to be read
 * (lib/stable-steps). The chips used to show the rules at once, swap in the
 * model's steps a few seconds later, then reshuffle on every poll of a screen
 * that was still scrolling (operator, 2026-10-15: "they rapidly change, you
 * cannot see them").
 */
export function useStableSteps(
  key: string | null,
  ai: readonly string[] | null,
  rules: readonly string[],
  hold = false,
): string[] {
  const [shown, setShown] = useState<ShownSteps>(null);
  const [timedOut, setTimedOut] = useState<string | null>(null);
  useEffect(() => {
    if (!key || ai) return;
    const t = window.setTimeout(() => setTimedOut(key), FALLBACK_MS);
    return () => window.clearTimeout(t);
  }, [key, ai]);
  const next = nextShownSteps({ shown, key, ai, rules, timedOut: timedOut === key, hold });
  if (next !== shown) setShown(next);
  return visibleSteps(next, key);
}
