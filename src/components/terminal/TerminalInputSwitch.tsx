"use client";

import { Keyboard, Mic, Paperclip } from "lucide-react";
import { TERMINAL_INPUT_MODES, type TerminalInputMode } from "@/config/terminal-modes";

const ICONS = {
  type: [Keyboard],
  // Prompt is where screenshots and dictation live (THE composer). Both icons
  // are drawn so "where do I attach a screenshot?" is answered by looking.
  prompt: [Paperclip, Mic],
  voice: [Mic],
} satisfies Record<TerminalInputMode, (typeof Keyboard)[]>;

/**
 * How your words reach the session, next to where you write them.
 *
 * On a phone this switch used to live only inside the session sheet, so the
 * terminal opened in Type (raw keystrokes: no attach, no mic) and attaching a
 * screenshot or talking to the agent meant finding a menu first.
 *
 * Only input modes live here. "Loki" (the session as a conversation) is a
 * VIEW, so it is in the header's view switch, which is drawn in both views —
 * a chip down here vanished with the dock the moment you used it.
 */
export function TerminalInputSwitch({
  inputMode,
  onInputModeChange,
  hide = [],
  selected = true,
}: {
  inputMode: TerminalInputMode;
  onInputModeChange: (mode: TerminalInputMode) => void;
  /** Modes not offered here because the surface already covers them (the
   *  current mode is always shown, so nobody is stranded in a hidden one). */
  hide?: readonly TerminalInputMode[];
  /** False while the surface shows something else (the phone's key deck, or
   *  nothing): the current mode stays drawn but is not marked as open. */
  selected?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Input mode">
      {TERMINAL_INPUT_MODES.filter(
        (option) => option.id === inputMode || !hide.includes(option.id),
      ).map((option) => {
        const active = selected && option.id === inputMode;
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
