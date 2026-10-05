"use client";

import { Keyboard, MessageCircle, Mic, Paperclip } from "lucide-react";
import { TERMINAL_INPUT_MODES, type TerminalInputMode } from "@/config/terminal-modes";

const ICONS = {
  type: [Keyboard],
  // Prompt is where screenshots and dictation live (THE composer). Both icons
  // are drawn so "where do I attach a screenshot?" is answered by looking.
  prompt: [Paperclip, Mic],
  voice: [Mic],
} satisfies Record<TerminalInputMode, (typeof Keyboard)[]>;

/**
 * How you work with the session, next to where you write.
 *
 * Chat is the first position: the same Claude session read as a conversation
 * — your messages as bubbles, its answers as text, the way the Claude app shows
 * it. Type, Prompt and Voice are the raw terminal with three ways to reach it.
 *
 * This switch used to end in a fourth chip, "Loki", that opened the Loki panel
 * — the same panel as the Loki button one row up in the header. On a phone that
 * was three ways to say "talk" (a chat icon, Loki, Loki) and none of them was
 * "show me this session as a chat", which is what tapping Loki was expected to
 * do. One switch, one meaning per chip; the panel keeps its header button.
 */
export function TerminalInputSwitch({
  inputMode,
  onInputModeChange,
  chat,
}: {
  inputMode: TerminalInputMode;
  /** Picking Type/Prompt/Voice also leaves the chat view — the caller's job. */
  onInputModeChange: (mode: TerminalInputMode) => void;
  /** The conversation view. Omitted when the session's agent writes no
   *  Claude Code log (it has nothing to show as a chat). */
  chat?: { active: boolean; onSelect: () => void };
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="How to work">
      {chat && (
        <button
          type="button"
          onClick={chat.onSelect}
          title="Read and write this session as a conversation"
          aria-pressed={chat.active}
          className={chat.active ? "ui-chip-toggle-active gap-1" : "ui-chip-toggle gap-1"}
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
          Chat
        </button>
      )}
      {TERMINAL_INPUT_MODES.map((option) => {
        const active = !chat?.active && option.id === inputMode;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onInputModeChange(option.id)}
            title={option.hint}
            aria-pressed={active}
            className={active ? "ui-chip-toggle-active gap-1" : "ui-chip-toggle gap-1"}
          >
            {ICONS[option.id].map((Icon, i) => (
              <Icon key={i} className="h-3.5 w-3.5" aria-hidden="true" />
            ))}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
