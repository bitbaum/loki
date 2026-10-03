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
 */
export type Queued<T> = T & { id: number };

export function useSendQueue<T extends object>() {
  const [items, setItems] = useState<Queued<T>[]>([]);
  const ref = useRef<Queued<T>[]>([]);
  const write = useCallback((next: Queued<T>[]) => {
    ref.current = next;
    setItems(next);
  }, []);

  const add = useCallback(
    (item: T) => write([...ref.current, { ...item, id: Date.now() + ref.current.length }]),
    [write],
  );
  const remove = useCallback(
    (id: number) => write(ref.current.filter((q) => q.id !== id)),
    [write],
  );
  /** Pop the oldest, or null. */
  const takeNext = useCallback((): Queued<T> | null => {
    const [next, ...rest] = ref.current;
    if (!next) return null;
    write(rest);
    return next;
  }, [write]);

  return { items, add, remove, takeNext };
}
