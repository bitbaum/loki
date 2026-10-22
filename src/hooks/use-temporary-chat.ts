"use client";

import { useEffect, useRef, useState } from "react";
import { leavesTemporary } from "@/lib/loki/temporary-chat";

/**
 * The client half of a temporary chat (lib/loki/temporary-chat.ts).
 *
 *   armed   the next thread the person starts is temporary (the menu toggle)
 *   id      the temporary thread they are in, once it exists
 *
 * Leaving it — the active thread changing to anything else, or the page
 * going away — deletes it. The delete is sent with `keepalive`, so a closed
 * tab still gets it out. The workspace never lists it: `claim` is called
 * instead of adding the new thread to the rail.
 */
export function useTemporaryChat(activeId: string | null) {
  const [armed, setArmed] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const idRef = useRef<string | null>(null);
  const prevActive = useRef<string | null>(activeId);

  const discard = (threadId: string) => {
    idRef.current = null;
    setId(null);
    void fetch(`/api/conversations/${threadId}`, { method: "DELETE", keepalive: true }).catch(
      () => {
        /* the sweep takes it within a day */
      },
    );
  };

  useEffect(() => {
    const prev = prevActive.current;
    prevActive.current = activeId;
    if (leavesTemporary(prev, activeId, idRef.current)) discard(idRef.current!);
  }, [activeId]);

  useEffect(() => {
    const onHide = () => {
      if (idRef.current) discard(idRef.current);
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      if (idRef.current) discard(idRef.current);
    };
  }, []);

  return {
    armed,
    id,
    toggle: () => setArmed((v) => !v),
    /** The thread was created temporary: it is the one to delete on leaving. */
    claim: (threadId: string) => {
      idRef.current = threadId;
      setId(threadId);
      setArmed(false);
    },
  };
}
