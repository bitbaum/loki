"use client";

import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import { getJson, patchJson } from "@/lib/api/fetch";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import type { RailMode } from "@/components/loki/ThreadRail";
import type { ConversationSummary } from "@/components/loki/types";

/** How the rail orders threads: by what needs you, or folded under projects. */
const RAIL_MODE_KEY = "loki:rail-mode";
const modeSerialize = (v: RailMode) => v;
const modeDeserialize = (raw: string): RailMode => (raw === "project" ? "project" : "recent");

/**
 * The two small facts the rail keeps per thread, written from the chat:
 * read and pinned (lib/loki/thread-state.ts reads them).
 *
 * Having the thread open is reading it. Every message on screen — an
 * answer, a run's outcome the outcome poll brought in, a question — is read
 * the moment it is there, so the rail stops calling it news. Keyed on the
 * message count: a thread that gains a message while open is read again, a
 * thread merely re-rendered is not re-sent. The list is updated from the
 * server's answer, never synchronously inside the effect.
 *
 * Lifted out of LokiWorkspace, which is at its line cap.
 */
export function useThreadInbox(
  activeId: string | null,
  transcriptLoading: boolean,
  messageCount: number,
  setConversations: Dispatch<SetStateAction<ConversationSummary[]>>,
): {
  pinConversation: (id: string, pinned: boolean) => void;
  railMode: RailMode;
  setRailMode: (mode: RailMode) => void;
  /** Re-read the list from the server, keeping the thread on screen read. */
  syncConversations: (readId: string | null) => void;
} {
  const [railMode, setRailMode] = useLocalStorageState<RailMode>(
    RAIL_MODE_KEY,
    "recent",
    modeSerialize,
    modeDeserialize,
  );

  useEffect(() => {
    if (!activeId || transcriptLoading || messageCount === 0) return;
    let current = true;
    patchJson(`/api/conversations/${activeId}`, { read: true })
      .then(async (res) => {
        if (!current || !res.ok) return;
        const body = (await res.json().catch(() => ({}))) as { readAt?: string | null };
        const at = body.readAt ?? new Date().toISOString();
        setConversations((prev) =>
          prev.map((c) => (c.id === activeId ? { ...c, lastReadAt: at } : c)),
        );
      })
      .catch(() => {
        /* the next open marks it again */
      });
    return () => {
      current = false;
    };
  }, [activeId, transcriptLoading, messageCount, setConversations]);

  const pinConversation = useCallback(
    (id: string, pinned: boolean) => {
      const at = pinned ? new Date().toISOString() : null;
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, pinnedAt: at } : c)));
      void patchJson(`/api/conversations/${id}`, { pinned }).catch(() => {
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, pinnedAt: pinned ? null : at } : c)),
        );
      });
    },
    [setConversations],
  );

  // The thread a turn just landed in is on screen, so it is read: the list
  // must not show the answer that just streamed in as news.
  const syncConversations = useCallback(
    (readId: string | null) => {
      void getJson<{ conversations: ConversationSummary[] }>("/api/conversations")
        .then((d) =>
          setConversations(
            d.conversations.map((c) =>
              c.id === readId ? { ...c, lastReadAt: new Date().toISOString() } : c,
            ),
          ),
        )
        .catch(() => {
          /* keep the existing list on a transient failure */
        });
    },
    [setConversations],
  );

  // One stable object, so a caller may depend on it as a whole.
  return useMemo(
    () => ({ pinConversation, railMode, setRailMode, syncConversations }),
    [pinConversation, railMode, setRailMode, syncConversations],
  );
}
