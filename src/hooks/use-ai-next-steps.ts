"use client";

import { useEffect, useRef, useState } from "react";
import type { NextStepsSource } from "@/lib/terminal-next-steps";

/** Wait this long after the last change before asking — a working agent's
 *  screen changes every second, and only the settled screen is worth a call. */
const SETTLE_MS = 2_500;

/**
 * AI-written next steps for `context` (lib/terminal-next-steps), fetched once
 * it has stopped changing. Returns null while none have arrived for the
 * current context, so the caller keeps showing the rule-based chips.
 *
 * One request per distinct context: the last one asked for is remembered, so
 * a poll that reads the same screen again costs nothing.
 */
export function useAiNextSteps(
  context: string | null,
  source: NextStepsSource,
  project: string | null,
): string[] | null {
  const [result, setResult] = useState<{ context: string; steps: string[] } | null>(null);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (!context || context === asked.current) return;
    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      asked.current = context;
      try {
        const res = await fetch("/api/terminal/next-steps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context, source, project }),
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => ({}))) as { steps?: unknown };
        const steps = Array.isArray(data.steps)
          ? data.steps.filter((s): s is string => typeof s === "string")
          : [];
        setResult({ context, steps });
      } catch {
        /* aborted or offline — the rule-based chips stay */
      }
    }, SETTLE_MS);
    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
  }, [context, source, project]);

  return result && result.context === context ? result.steps : null;
}
