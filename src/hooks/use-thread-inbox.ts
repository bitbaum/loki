"use client";

import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { getJson, patchJson, postJson } from "@/lib/api/fetch";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import type { RailMode } from "@/components/loki/ThreadRail";
import type { ConversationSummary } from "@/components/loki/types";

/** Naming waits this long after the answer, then retries this often if the
 *  model was busy (`retry: true` from the title route). */
const TITLE_FIRST_ASK_MS = 3_000;
const TITLE_RETRY_DELAYS_MS = [10_000, 30_000];

/** How the rail orders threads: by what needs you, or folded under projects. */
const RAIL_MODE_KEY = "loki:rail-mode";
const modeSerialize = (v: RailMode) => v;
const modeDeserialize = (raw: string): RailMode => (raw === "project" ? "project" : "recent");

/**
 * The small facts the rail keeps per thread, written from the chat: read,
 * pinned, and what the thread is called (lib/loki/thread-state.ts and
 * lib/loki/thread-title.ts read them).
 *
 * Naming: once a thread has its first answer — when it lands, or the first
 * time an older thread is opened this session — the server is asked once to
 * name it from the exchange. It declines, without a model call, for a title
 * a person chose, so asking is always safe; the per-session set only stops
 * a failed naming from being retried on every message.
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
  /** A person's own title. Kept as typed (trimmed), never re-derived. */
  renameConversation: (id: string, title: string) => void;
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

  const titled = useRef(new Set<string>());
  useEffect(() => {
    if (!activeId || transcriptLoading || messageCount < 2) return;
    if (titled.current.has(activeId)) return;
    titled.current.add(activeId);
    const id = activeId;
    // Asked a moment after the answer, and again if the reply was unusable
    // (a busy or truncated model): a single ask failed often enough in
    // production to leave most new threads named by their opening line.
    const ask = (attempt: number) => {
      postJson(`/api/conversations/${id}/title`, {})
        .then(async (res) => {
          if (!res.ok) return;
          const body = (await res.json().catch(() => ({}))) as {
            title?: string;
            changed?: boolean;
            retry?: boolean;
          };
          if (body.changed && body.title) {
            const title = body.title;
            setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
          } else if (body.retry && attempt < TITLE_RETRY_DELAYS_MS.length) {
            setTimeout(() => ask(attempt + 1), TITLE_RETRY_DELAYS_MS[attempt]);
          }
        })
        .catch(() => {
          /* the thread keeps its opening line as its title */
        });
    };
    // Deliberately no cleanup that cancels the ask: a person who switches
    // thread the moment an answer lands still wants it named.
    setTimeout(() => ask(0), TITLE_FIRST_ASK_MS);
  }, [activeId, transcriptLoading, messageCount, setConversations]);

  const renameConversation = useCallback(
    (id: string, raw: string) => {
      const title = raw.trim().slice(0, 200);
      if (!title) return;
      let previous: string | undefined;
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          previous = c.title;
          return { ...c, title };
        }),
      );
      // A person named it: Loki must never rename it again this session.
      titled.current.add(id);
      void patchJson(`/api/conversations/${id}`, { title })
        .then((res) => {
          if (res.ok) return;
          throw new Error("rename refused");
        })
        .catch(() => {
          if (previous === undefined) return;
          const back = previous;
          setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: back } : c)));
        });
    },
    [setConversations],
  );

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
    () => ({ pinConversation, renameConversation, railMode, setRailMode, syncConversations }),
    [pinConversation, renameConversation, railMode, setRailMode, syncConversations],
  );
}
