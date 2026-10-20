"use client";

import { useState } from "react";
import { clearLokiDraft, lokiDraftKey } from "@/lib/loki/draft";

/**
 * "New chat" in Loki: leave the thread AND start a blank box.
 *
 * Leaving alone is not enough. On the start page nothing else changes, so a
 * press did nothing anyone could see — the half-typed draft stayed and the
 * cursor stayed wherever it was (watch-mode report, 2026-10-20: "pressed New
 * chat three times and nothing happened"). `fresh` is bumped on every press;
 * the composer empties itself and takes the cursor when it changes.
 *
 * Back on a phone's thread header only LEAVES (the `leave` passed in): no
 * keyboard, and the start page's draft is still there. `closeChats` shuts the
 * chats drawer, which is where a phone's "New chat" is often pressed.
 */
export function useNewChat(leave: () => void, closeChats: () => void) {
  const [fresh, setFresh] = useState(0);
  const start = () => {
    // Before the switch: the box restores this key's draft when it moves to it.
    clearLokiDraft(lokiDraftKey(null));
    leave();
    closeChats();
    setFresh((n) => n + 1);
  };
  return { fresh, start };
}
