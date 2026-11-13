"use client";

import { useCallback, useRef, useState } from "react";

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
 * Each message belongs to the CONVERSATION it was typed in, as in
 * `@bitbaum/chatkit`'s `useChatApp`. Without that, a message queued in a new
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

export function readStoredQueue<T extends object>(raw: string | null): Queued<T>[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (q): q is Queued<T> =>
        !!q &&
        typeof q === "object" &&
        typeof (q as { id?: unknown }).id === "number" &&
        typeof (q as { conversationId?: unknown }).conversationId === "string" &&
        typeof (q as { text?: unknown }).text === "string",
    );
  } catch {
    return [];
  }
}

/** What may be written down: everything but a message that carries files. */
export function storableQueue<T extends object>(items: Queued<T>[]): Queued<T>[] {
  return items.filter((q) => {
    const files = (q as { attachments?: unknown }).attachments;
    return !Array.isArray(files) || files.length === 0;
  });
}

/** The oldest message waiting in `conversationId`, and the queue without it. */
export function takeFor<T extends object>(
  items: Queued<T>[],
  conversationId: string,
): { next: Queued<T> | null; rest: Queued<T>[] } {
  const next = items.find((q) => q.conversationId === conversationId) ?? null;
  return { next, rest: next ? items.filter((q) => q.id !== next.id) : items };
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
