"use client";

import { useState, type ReactNode } from "react";
import { Keyboard, MessageSquare } from "lucide-react";
import { TERMINAL_KEYS } from "@/config/terminal-keys";
import type { BuilderChannel } from "@/lib/constants/statuses";
import { TerminalSessionInfo } from "./SessionInfo";
import { KeyCap, TerminalKeyDeck } from "./TerminalKeyDeck";

/**
 * Everything below the phone's terminal: the session box, and the keys a soft
 * keyboard lacks one press away.
 *
 * It used to be a bar of three modes — Type (keystrokes, no microphone),
 * Prompt (a task, with a microphone), Keys — that a person had to choose
 * between before they could say anything (operator, 2026-10-15: "this is
 * awful"). Now there is ONE box, the same one the conversation view uses
 * (SessionComposer, passed in as `box`), with the microphone, screenshots and
 * the prompt library. Keys is a button in that box's tool row; it opens the
 * arrows, Esc, Tab and Ctrl — never a second text box (an exact-keystrokes
 * line used to sit there and read as a second place to write). Keystrokes
 * straight into the screen are the session menu's "Live keystrokes".
 *
 * Full screen is for watching: the box folds to a bar with Esc and Enter (a
 * "Continue?" must stay one press) and a button that brings the box back.
 */
export function TerminalMobileDock({
  onKey,
  box,
  session,
  keysOpen,
  onKeysOpenChange,
  immersive,
}: {
  /** Verbatim bytes into the session. */
  onKey: (bytes: string) => void;
  /** The session box (SessionComposer), given the tools for its row: the
   *  model chip, and Keys on a phone. */
  box: (tools: ReactNode) => ReactNode;
  /** Whose model the chip reads and changes. */
  session: {
    tab: string;
    channel: BuilderChannel;
    agent: string | null;
    onKey: (bytes: string) => void | Promise<void>;
  };
  keysOpen: boolean;
  onKeysOpenChange: (open: boolean) => void;
  immersive: boolean;
}) {
  const [writing, setWriting] = useState(!immersive);
  // Entering full screen is a request to watch; leaving it, to write again.
  const [layout, setLayout] = useState(immersive);
  if (layout !== immersive) {
    setLayout(immersive);
    setWriting(!immersive);
  }

  const keys = keysOpen && <TerminalKeyDeck onKey={onKey} />;

  if (writing) {
    return (
      <div className="ui-term-dock">
        {/* On the terminal's corner, not in the box: the keys act on the
            screen, and in the box's row they left the model's name three
            letters ("Op…") — the row is now the same in both views. */}
        <span className="md:hidden">
          <KeysToggle open={keysOpen} onOpenChange={onKeysOpenChange} floating />
        </span>
        {keys}
        {box(<TerminalSessionInfo {...session} />)}
      </div>
    );
  }

  return (
    <div className="ui-term-dock">
      {keys}
      <div className="ui-term-watchbar" role="toolbar" aria-label="Session controls">
        <button type="button" className="ui-chip-toggle gap-1.5" onClick={() => setWriting(true)}>
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
          Message
        </button>
        <KeysToggle open={keysOpen} onOpenChange={onKeysOpenChange} />
        <div className="ml-auto flex items-center gap-1.5">
          <KeyCap keyDef={TERMINAL_KEYS.esc} onKey={onKey} className="ui-term-key" />
          <KeyCap
            keyDef={TERMINAL_KEYS.enter}
            onKey={onKey}
            className="ui-term-key ui-term-key-accent"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The arrows, Esc, Ctrl and exact keystrokes — a soft keyboard has none.
 * `floating`: a round button on the terminal's bottom corner, above the box.
 */
export function KeysToggle({
  open,
  onOpenChange,
  floating = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  floating?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenChange(!open)}
      aria-pressed={open}
      aria-label="Keys"
      title="Arrows, Esc, Tab and Ctrl — the keys a phone keyboard lacks"
      className={floating ? "ui-term-keys-float" : open ? "ui-box-chip-active" : "ui-box-chip"}
    >
      <Keyboard className={floating ? "h-4.5 w-4.5" : "h-4 w-4"} aria-hidden="true" />
      {!floating && "Keys"}
    </button>
  );
}
