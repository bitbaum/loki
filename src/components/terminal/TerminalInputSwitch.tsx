"use client";

import { Keyboard, MessagesSquare, Mic, Paperclip } from "lucide-react";
import { TERMINAL_INPUT_MODES, type TerminalInputMode } from "@/config/terminal-modes";

const ICONS = {
  type: [Keyboard],
  // Prompt is where screenshots and dictation live (THE composer). Both icons
  // are drawn so "where do I attach a screenshot?" is answered by looking.
  prompt: [Paperclip, Mic],
  voice: [Mic],
} satisfies Record<TerminalInputMode, (typeof Keyboard)[]>;

/**
 * How your words reach the session, next to where you write them — plus Chat.
 *
 * On a phone this switch used to live only inside the session sheet, so the
 * terminal opened in Type (raw keystrokes: no attach, no mic) and attaching a
 * screenshot or talking to the agent meant finding a menu first. Chat — the
 * Loki panel for this project and run — sat behind an unlabeled icon.
 */
export function TerminalInputSwitch({
  inputMode,
  onInputModeChange,
  onOpenChat,
}: {
  inputMode: TerminalInputMode;
  onInputModeChange: (mode: TerminalInputMode) => void;
  /** Opens the Loki chat panel. Omitted where there is no project to chat about. */
  onOpenChat?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Input mode">
      {TERMINAL_INPUT_MODES.map((option) => {
        const active = option.id === inputMode;
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
      {onOpenChat && (
        <button
          type="button"
          onClick={onOpenChat}
          title="Chat with Loki about this project and run"
          className="ui-chip-toggle gap-1"
        >
          <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />
          Chat
        </button>
      )}
    </div>
  );
}
