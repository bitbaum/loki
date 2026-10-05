"use client";

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
 */
export function useTerminalView(agentId: string | null) {
  const [pref, setPref] = useLocalStorageState<TerminalViewMode>(
    TERMINAL_VIEW_STORAGE_KEY,
    "chat",
    (v) => v,
    (raw) => (raw === "terminal" ? "terminal" : "chat"),
  );
  const chatAvailable = chatViewSupported(agentId);
  const view: TerminalViewMode = chatAvailable ? pref : "terminal";
  return {
    view,
    chatAvailable,
    setView: (next: TerminalViewMode) => setPref(next),
    showTerminal: () => setPref("terminal"),
  };
}
