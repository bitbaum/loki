"use client";

import { useState } from "react";
import { Repeat2 } from "lucide-react";
import { CYCLE_MODE_KEY } from "@/lib/claude-transcript";

/**
 * Claude Code's permission mode (Auto / Accept edits / Plan …) in the
 * composer's bottom row, where the Claude app shows it. A tap sends
 * Shift+Tab — the TUI's own "next mode" key.
 *
 * It does not offer a list of modes to pick from, on purpose: setting one
 * means pressing Shift+Tab the right number of times, and the order differs
 * between Claude Code versions and settings, so a picker would sometimes
 * land on the wrong mode and say otherwise. The mode shown is the one
 * recorded on your last message; after a tap it says the new one appears
 * with your next message, which is when Claude Code writes it down.
 */
export function SessionModeChip({
  mode,
  lastMessageId,
  onKey,
}: {
  mode: { id: string; label: string };
  /** Your newest message: a new one means the log has caught up with taps. */
  lastMessageId: string | null;
  onKey: (bytes: string) => void | Promise<void>;
}) {
  const [cycledAfter, setCycledAfter] = useState<string | null | undefined>(undefined);
  const pending = cycledAfter !== undefined && cycledAfter === lastMessageId;
  return (
    <button
      type="button"
      className="ui-claude-mode"
      onClick={() => {
        void onKey(CYCLE_MODE_KEY);
        setCycledAfter(lastMessageId);
      }}
      title={
        pending
          ? "Switched — Claude Code records the new mode with your next message. Tap again for the next one."
          : "Switch to Claude Code's next mode (Shift+Tab)"
      }
      aria-label={
        pending
          ? `Mode switched from ${mode.label}; the new mode shows after your next message`
          : `Mode: ${mode.label}. Tap to switch to the next mode`
      }
    >
      <Repeat2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{pending ? "Switched…" : mode.label}</span>
    </button>
  );
}
