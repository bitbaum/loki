"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import {
  TERMINAL_VIEW_STORAGE_KEY,
  chatViewSupported,
  type TerminalViewMode,
} from "@/config/terminal-modes";

/**
 * Chat or raw terminal for the attached session. Chat is the default way to
 * SEE a Claude session; the raw terminal is one tap away and remembered once
 * chosen. An agent that writes no Claude Code log always gets the terminal.
 *
 * The deep link's `?view=chat|terminal` wins: a "Watch" link opens the view
 * it names whatever was remembered, without overwriting the remembered choice
 * — until the reader flips the switch, which is then saved as usual.
 */
export function useTerminalView(agentId: string | null) {
  const requested = useSearchParams().get("view");
  const [linked, setLinked] = useState<TerminalViewMode | null>(() =>
    requested === "chat" || requested === "terminal" ? requested : null,
  );
  const [pref, setPref] = useLocalStorageState<TerminalViewMode>(
    TERMINAL_VIEW_STORAGE_KEY,
    "chat",
    (v) => v,
    (raw) => (raw === "terminal" ? "terminal" : "chat"),
  );
  const chatAvailable = chatViewSupported(agentId);
  const view: TerminalViewMode = chatAvailable ? (linked ?? pref) : "terminal";
  const choose = (next: TerminalViewMode) => {
    setLinked(null);
    setPref(next);
  };
  return {
    view,
    chatAvailable,
    setView: choose,
    showTerminal: () => choose("terminal"),
  };
}
