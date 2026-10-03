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
