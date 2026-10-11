"use client";

import { useEffect, useState } from "react";
import type { DispatchLiveView } from "@/lib/dispatch-status";

/**
 * Poll a dispatch's live status so every surface that fires one — Loki's
 * transcript, the prompt library's "Send to terminal", the terminal's own
 * prompt composer — converges on the same recorded lifecycle (queued →
 * picked up → ran / failed) instead of freezing on the optimistic snapshot
 * from the moment the POST returned 200.
 *
 * Extracted from Transcript.tsx, where this was the only place a dispatch's
 * outcome was ever actually tracked after the click — every other fire-site
 * discarded the response body and showed a static "Sent" that looked
 * identical whether the work ran immediately or queued forever behind an
 * offline builder. SSOT so a fix here (a new terminal state, a longer poll
 * window) reaches every caller at once.
 */
const POLL_MS = 2_500;
/** GitHub is asked at most every few minutes server-side (fixNeedsRefresh);
 *  this only decides how soon the card hears about it. */
const FOLLOW_POLL_MS = 30_000;
const FOLLOW_FOR_MS = 2 * 60 * 60_000;

export function useDispatchLiveStatus(
  commandId: string | null,
  runId: string | null,
): DispatchLiveView | null {
  const [view, setView] = useState<DispatchLiveView | null>(null);
  useEffect(() => {
    const statusUrl = commandId
      ? `/api/control/commands/${commandId}`
      : runId
        ? `/api/orchestration/runs/${runId}`
        : null;
    // Neither id given — nothing to poll. Deliberately not resetting `view`
    // here (that would be a synchronous setState-in-effect): every caller
    // already gates rendering on `commandId || runId` being non-null, so a
    // stale view from a previous id is never actually shown once both go
    // null, and it's naturally replaced the next time a real id arrives.
    if (!statusUrl) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const since = Date.now();
    const poll = async () => {
      let delay = POLL_MS;
      try {
        const res = await fetch(statusUrl);
        if (res.ok) {
          const v = (await res.json()) as DispatchLiveView;
          if (!active) return;
          setView(v);
          // The run is over, but its change is still on its way to the live
          // site (PR → merge → deploy → Loki's look): keep asking, slowly,
          // while this card is open — and not all day.
          if (v.terminal) {
            if (!v.follow || v.follow.settled || Date.now() - since > FOLLOW_FOR_MS) return;
            delay = FOLLOW_POLL_MS;
          }
        }
      } catch {
        /* transient — retry below */
      }
      if (active) timer = setTimeout(poll, delay);
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [commandId, runId]);
  return view;
}
