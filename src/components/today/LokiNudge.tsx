"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { HOUR_MS } from "@/lib/constants/time";

const CACHE_PREFIX = "loki-loki-nudge-v1:";
const CACHE_TTL_MS = HOUR_MS;

type CacheEntry = { composed: string; expiresAt: number };

function cacheKey(kind: string, title: string, context: string): string {
  // Stable enough — the focus content changes when any of these change.
  return `${CACHE_PREFIX}${kind}|${title}|${context}`;
}

function readCache(key: string): string | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (parsed.expiresAt < Date.now()) return null;
    return parsed.composed;
  } catch {
    return null;
  }
}

function writeCache(key: string, composed: string) {
  try {
    const entry: CacheEntry = { composed, expiresAt: Date.now() + CACHE_TTL_MS };
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // localStorage failures shouldn't break the UI.
  }
}

/**
 * LokiNudge — upgrades a Watch focus from templated context to Loki-composed
 * prose, WHEN THE PERSON ASKS. The server-rendered template line is the answer
 * by default; the button spends one model call on a friendlier phrasing.
 *
 * It used to fetch on mount: every /today load with a focus item called the
 * model, and the only person "asking" was the page. The box's AI keys are free
 * tiers shared by every app, so a render may not spend them (2026-09-25). A
 * cached composition (one hour, localStorage) still shows without a click —
 * it was already paid for by one.
 *
 * If the compose endpoint is unavailable (no API key, rate-limited, timeout),
 * the parent's template prose stays in place. Strict enhancement.
 */
export function LokiNudge({
  kind,
  title,
  context,
}: {
  kind: string;
  title: string;
  context: string;
}) {
  const [composed, setComposed] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  // Reading the cache is free; only compose() spends a model call.
  useEffect(() => {
    const cached = readCache(cacheKey(kind, title, context));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time (or prop-change) cache hydration; deferred render is fine for this enhancement
    setComposed(cached);
    setState(cached ? "ready" : "idle");
  }, [kind, title, context]);

  async function compose() {
    setState("loading");
    try {
      const res = await postJson("/api/today/watch/compose", { kind, title, context });
      const data = res.ok ? ((await res.json()) as { composed?: string }) : null;
      if (!data?.composed) {
        setState("error");
        return;
      }
      writeCache(cacheKey(kind, title, context), data.composed);
      setComposed(data.composed);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  if (state === "error") return null;

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={() => void compose()}
        className="ui-loki-nudge text-left"
        title="One AI call: Loki rewrites this item as a short suggested next step."
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent-text" />
        <span className="ui-loki-nudge-text">Ask Loki for a next step</span>
      </button>
    );
  }

  return (
    <div className="ui-loki-nudge">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent-text" />
      <span className="ui-loki-nudge-text">
        {state === "ready" ? (
          composed
        ) : (
          <span className="ui-loki-nudge-shimmer">Loki is composing…</span>
        )}
      </span>
    </div>
  );
}
