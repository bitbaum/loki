"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import { getJson } from "@/lib/api/fetch";
import type { LokiMessage } from "@/components/loki/types";

/**
 * A dispatch is a job that finishes after the reply. Its outcome is written
 * back into the thread by the server when the run closes
 * (lib/orchestration/run-outcome-post.ts); while the newest turn is still a
 * dispatch, re-read the thread so that outcome shows up without a reload.
 * Stops the moment any later turn exists — the outcome itself ends it.
 *
 * Lifted out of LokiWorkspace when the component reached the line cap.
 */
export function useDispatchOutcome(
  activeId: string | null,
  messages: LokiMessage[],
  setMessages: Dispatch<SetStateAction<LokiMessage[]>>,
): void {
  const awaiting =
    activeId !== null && messages.length > 0 && messages[messages.length - 1]?.kind === "dispatch";
  useEffect(() => {
    if (!awaiting || !activeId) return;
    let current = true;
    const tick = () =>
      getJson<{ messages: LokiMessage[] }>(`/api/conversations/${activeId}`)
        .then((d) => {
          if (current && d.messages.length > messages.length) setMessages(d.messages);
        })
        .catch(() => undefined);
    const timer = window.setInterval(tick, 20_000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaiting, activeId, messages.length]);
}
