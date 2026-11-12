"use client";

import { useEffect, useState } from "react";
import { GONE_DISPATCH_VIEW, type DispatchLiveView } from "@/lib/dispatch-status";

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
/** A card that has not settled in this long (queued behind an offline
 *  runner, say) is asked slowly from then on, not every 2.5 seconds. */
const FAST_FOR_MS = 10 * 60_000;

export function useDispatchLiveStatus(
  commandId: string | null,
  runId: string | null,
): DispatchLiveView | null {
  const statusUrl = commandId
    ? `/api/control/commands/${commandId}`
    : runId
      ? `/api/orchestration/runs/${runId}`
      : null;
  const [snapshot, setSnapshot] = useState<{ url: string; view: DispatchLiveView } | null>(null);
  useEffect(() => {
    // Keep the result bound to the command that produced it. A second send
    // must not borrow the previous task's completion while its first poll waits.
    if (!statusUrl) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const since = Date.now();
    const poll = async () => {
      let delay = Date.now() - since > FAST_FOR_MS ? FOLLOW_POLL_MS : POLL_MS;
      try {
        const res = await fetch(statusUrl);
        // The record is gone: say so once and stop asking. An old card kept
        // its stored "waiting" label and polled the 404 for as long as the
        // thread was open (owner audit, 2026-11-12).
        if (res.status === 404 || res.status === 410) {
          if (active) setSnapshot({ url: statusUrl!, view: GONE_DISPATCH_VIEW });
          return;
        }
        if (res.ok) {
          const v = (await res.json()) as DispatchLiveView;
          if (!active) return;
          setSnapshot({ url: statusUrl!, view: v });
          // The run is over, but its change is still on its way to the live
          // site (PR → merge → deploy → Loki's look): keep asking, slowly,
          // while this card is open — and not all day.
          if (v.terminal) {
            const settled = v.track ? v.track.settled : !v.follow || v.follow.settled;
            if (settled || Date.now() - since > FOLLOW_FOR_MS) return;
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
  }, [statusUrl]);
  return snapshot?.url === statusUrl ? snapshot.view : null;
}
