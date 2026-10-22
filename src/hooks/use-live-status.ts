"use client";

import { useEffect, useState } from "react";
import { LOKI_STATUS_COPY } from "@/lib/loki/stream";
import type { LiveTurn } from "@/hooks/use-loki-stream";

/**
 * "12s · Running list projects" — the live line under a Loki turn in flight,
 * with its clock. A turn runs tens of seconds; "Working on it" with no clock
 * is, on a phone, indistinguishable from a hang. Shared by the terminal's
 * Loki rail and the prompt library's Run sheet.
 */
export function useLiveStatus(live: LiveTurn | null): string | undefined {
  const [now, setNow] = useState(() => Date.now());
  const since = live?.startedAt ?? 0;
  useEffect(() => {
    if (!since) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [since]);
  if (!live || !since) return undefined;
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const clock = s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
  const running = live.tools.findLast((t) => t.phase === "start");
  const doing = live.status
    ? LOKI_STATUS_COPY[live.status]
    : running
      ? `Running ${running.name.replace(/_/g, " ")}`
      : LOKI_STATUS_COPY.thinking;
  return `${clock} · ${doing}`;
}
