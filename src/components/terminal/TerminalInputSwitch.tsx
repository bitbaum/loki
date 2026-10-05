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
 * How your words reach the session, next to where you write them — plus Loki,
 * which switches the screen to the session as a conversation.
 *
 * On a phone this switch used to live only inside the session sheet, so the
 * terminal opened in Type (raw keystrokes: no attach, no mic) and attaching a
 * screenshot or talking to the agent meant finding a menu first. The Loki
 * panel (summary, Ask/Inject for this run) sat behind an unlabeled icon.
 */
export function TerminalInputSwitch({
  inputMode,
  onInputModeChange,
  onOpenLoki,
  onShowConversation,
}: {
  inputMode: TerminalInputMode;
  onInputModeChange: (mode: TerminalInputMode) => void;
  /** Opens the Loki panel. Omitted where there is no project for it to be about. */
  onOpenLoki?: () => void;
  /** Shows this session as a conversation. When given, the Loki chip does
   *  this instead of opening the panel — see below. */
  onShowConversation?: () => void;
}) {
  // "Switch to Loki" means: show me this session the way a chat app does —
  // operator ask, 2026-10-05. Beside Type / Prompt / Voice the chip read as a
  // fourth way of working, and then opened a side panel ABOUT the session
  // instead. Where the agent writes no conversation log (not Claude), the
  // panel is still the best Loki view there is.
  const onLoki = onShowConversation ?? onOpenLoki;
  const lokiHint = onShowConversation
    ? "Show this session as a Loki conversation — messages instead of a terminal screen"
    : "Summarize this run and ask Loki about it";
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
      {onLoki && (
        <button type="button" onClick={onLoki} title={lokiHint} className="ui-chip-toggle gap-1">
          <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />
          Loki
        </button>
      )}
    </div>
  );
}
