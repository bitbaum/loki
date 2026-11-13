"use client";

import { useCallback, useRef, useState } from "react";
import { parseStoredQueue, storableQueue, takeQueuedFor } from "@bitbaum/chatkit";

/**
 * Messages typed while a turn ran, waiting their turn.
 *
 * The reference chat takes the next thought the moment it is finished being
 * typed — "Queue a message…" — and sends it when the turn ends; refusing it
 * until a spinner stops is the one place a chat makes the person wait on the
 * machine. The queue is drained by the SENDER after a turn lands, as an
 * event, never from an effect watching `sending`: an effect that sets state
 * on every turn boundary is a cascade React is entitled to run twice, and it
 * cannot know whether the turn that just ended succeeded.
 *
 * Held, not dropped, when a turn failed: the error and its Try again stand in
 * front of it. The list is mirrored in a ref so `takeNext` reads the current
 * queue from inside an async send that closed over an older render.
 *
 * The rules are `@bitbaum/chatkit`'s (`send-queue`); this hook is their React
 * state and their place in the tab's storage. Each message belongs to the
 * CONVERSATION it was typed in. Without that, a message queued in a new
 * chat was sent by a closure that still saw "no conversation" and opened a
 * second one: three quick messages became three conversations, and the screen
 * kept only the last (2026-11-13).
 *
 * Kept for the tab's lifetime (sessionStorage), so a reload mid-answer does
 * not throw away words the person was told would be sent. A message carrying
 * files is not stored: the files do not survive a reload either.
 */
export type Queued<T> = T & { id: number; conversationId: string };

const STORE_KEY = "loki:send-queue:v1";

/** Read back what was stored (`@bitbaum/chatkit` `parseStoredQueue`), ids as Loki writes them. */
export function readStoredQueue<T extends object>(raw: string | null): Queued<T>[] {
  return parseStoredQueue<{ text: string }>(raw).filter(
    (q) => typeof q.id === "number",
  ) as unknown as Queued<T>[];
}

/** The package's rules, under the names this hook's callers and tests use. */
export { storableQueue };
export function takeFor<T extends object>(
  items: Queued<T>[],
  conversationId: string,
): { next: Queued<T> | null; rest: Queued<T>[] } {
  const { next, rest } = takeQueuedFor(items, conversationId);
  // The same list back when nothing was taken, so a render that compares it sees no change.
  return { next, rest: next ? rest : items };
}

export function useSendQueue<T extends object>(activeConversationId: string | null) {
  const [all, setAll] = useState<Queued<T>[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return readStoredQueue<T>(window.sessionStorage.getItem(STORE_KEY));
    } catch {
      return [];
    }
  });
  const ref = useRef<Queued<T>[]>(all);
  const write = useCallback((next: Queued<T>[]) => {
    ref.current = next;
    setAll(next);
    try {
      window.sessionStorage.setItem(STORE_KEY, JSON.stringify(storableQueue(next)));
    } catch {
      // Private mode or a full store: the queue still works for this page.
    }
  }, []);

  const add = useCallback(
    (conversationId: string, item: T) =>
      write([...ref.current, { ...item, conversationId, id: Date.now() + ref.current.length }]),
    [write],
  );
  const remove = useCallback(
    (id: number) => write(ref.current.filter((q) => q.id !== id)),
    [write],
  );
  /** Pop the oldest message waiting in this conversation, or null. */
  const takeNext = useCallback(
    (conversationId: string): Queued<T> | null => {
      const { next, rest } = takeFor(ref.current, conversationId);
      if (next) write(rest);
      return next;
    },
    [write],
  );

  const items = all.filter((q) => q.conversationId === activeConversationId);
  return { items, add, remove, takeNext };
}
