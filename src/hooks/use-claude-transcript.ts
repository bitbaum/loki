"use client";

import { useEffect, useState } from "react";
import { mergeTranscriptItems, type TranscriptItem } from "@/lib/claude-transcript";
import type { TranscriptFrame } from "@/lib/sse-bus";

export type ClaudeTranscriptState = {
  items: TranscriptItem[];
  /** The SSE is open (not: Claude is running). */
  connected: boolean;
  /** At least one frame arrived — distinguishes "empty session" from "no data". */
  received: boolean;
  /** Claude's session id; null when the runner has the tab but Claude has
   *  written no log yet (it says so once, with an empty frame). */
  sessionId: string | null;
};

/**
 * The live Claude Code conversation for a session tab
 * (/api/control/transcript-stream). A `reset` frame replaces the list (a new
 * session, or the snapshot every viewer gets on joining); anything else
 * upserts by id, so a tool row turns from running to done in place.
 */
export function useClaudeTranscript(
  tab: string,
  channel?: "cloud" | "local",
): ClaudeTranscriptState {
  const [state, setState] = useState<ClaudeTranscriptState>({
    items: [],
    connected: false,
    received: false,
    sessionId: null,
  });

  useEffect(() => {
    const qs = new URLSearchParams({ tab, ...(channel ? { channel } : {}) });
    const es = new EventSource(`/api/control/transcript-stream?${qs}`);
    es.addEventListener("ready", () => setState((s) => ({ ...s, connected: true })));
    es.addEventListener("transcript", (e) => {
      try {
        const frame = JSON.parse((e as MessageEvent).data) as TranscriptFrame;
        setState((s) => ({
          connected: true,
          received: true,
          sessionId: frame.sessionId ?? (frame.reset ? null : s.sessionId),
          items: frame.reset ? frame.items : mergeTranscriptItems(s.items, frame.items),
        }));
      } catch {
        /* a malformed frame is skipped; the next snapshot heals the view */
      }
    });
    es.onerror = () => setState((s) => ({ ...s, connected: false }));
    return () => es.close();
  }, [tab, channel]);

  return state;
}
