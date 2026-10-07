"use client";
import { useCallback, useEffect, useState } from "react";
import { CONSULT } from "@/config/site-consult";
import type { Consultation } from "@/lib/site-consult/findings";

export type ConsultState =
  | { status: "idle" }
  | { status: "loading"; website: string }
  | { status: "ready"; website: string; consultation: Consultation }
  | { status: "error"; website: string; error: string };

/** A shape worth asking about — the server is the real judge. */
const looksLikeSite = (text: string) => /^[^\s]+\.[a-z]{2,}(?:[/?#]\S*)?$/i.test(text.trim());

/**
 * The consultation for whatever address the person has given — fetched once
 * the address settles (typing it out letter by letter must not read the site
 * eight times), cancelled when it changes, and retryable by hand.
 */
export function useSiteConsultation(website: string, enabled: boolean) {
  const [state, setState] = useState<ConsultState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const target = enabled && looksLikeSite(website) ? website.trim() : "";

  useEffect(() => {
    if (!target) {
      const frame = requestAnimationFrame(() => setState({ status: "idle" }));
      return () => cancelAnimationFrame(frame);
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState({ status: "loading", website: target });
      try {
        const response = await fetch(CONSULT.path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ website: target }),
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => ({}))) as {
          consultation?: Consultation;
          error?: string;
        };
        if (!response.ok || !body.consultation)
          throw new Error(body.error ?? "Loki could not read that site just now.");
        setState({ status: "ready", website: target, consultation: body.consultation });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          website: target,
          error: err instanceof Error ? err.message : "Loki could not read that site just now.",
        });
      }
    }, 700);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [target, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
