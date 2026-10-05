"use client";

import { useState } from "react";
import { Keyboard, PenLine } from "lucide-react";
import type { BuilderChannel } from "@/lib/event-stream-types";
import type { TerminalInputMode } from "@/config/terminal-modes";
import { TERMINAL_KEYS } from "@/config/terminal-keys";
import { KeyCap, TerminalKeyDeck } from "./TerminalKeyDeck";
import { TerminalRawComposer } from "./TerminalRawComposer";
import { TerminalComposer } from "./TerminalComposer";
import { TabVoiceMic } from "./TabVoiceMic";
import { TerminalInputSwitch } from "./TerminalInputSwitch";

/** What the full-screen dock has open: nothing (watching), the keys, or the
 *  composer. One at a time — two open panels is the stack this replaced. */
type WatchPanel = "none" | "keys" | "write";

/**
 * Everything below the screen: the keys, then the way you write.
 *
 * The deck is present in all three input modes and that is deliberate. Prompt
 * and Voice send a *task*; the agent answers with a question — "Continue?",
 * "Which of these?", "[✔] scan shell history" — and answering it needs Enter
 * and arrows no matter how the task was dispatched. Modes change how words are
 * delivered; they do not change the fact that a TUI asks yes/no questions.
 *
 * ONE bar, one panel at a time. The dock used to be two rows of keys, a mode
 * switch and a composer stacked together — more than half of a phone screen,
 * and four unrelated toolbars to read (operator, 2026-10-05: "it looks
 * Frankenstein"). Now there is a single bar: Keys and Write each open their
 * panel above it, and while watching Esc / Enter sit on the bar because
 * answering a "Continue?" must not take two taps. The two layouts differ only in what
 * starts open: the normal page opens on Write (it is where you type), full
 * screen opens on nothing (it is for watching).
 *
 * Voice is not offered on the phone switch: the composer's own mic already
 * dictates (into a box you can read before sending), so a third chip for the
 * same microphone was one more thing to tell apart. Loki lives in the header
 * — one entry point, not two.
 */
export function TerminalMobileDock({
  tab,
  channel,
  inputMode,
  onInputModeChange,
  onKey,
  liveKeys,
  immersive,
}: {
  tab: string;
  channel: BuilderChannel;
  inputMode: TerminalInputMode;
  onInputModeChange: (mode: TerminalInputMode) => void;
  /** Verbatim bytes into the session. */
  onKey: (bytes: string) => void;
  /** When on, xterm has the keyboard and the typing box would fight it for
   *  focus — so the deck stands alone. */
  liveKeys: boolean;
  immersive: boolean;
}) {
  const [panel, setPanel] = useState<WatchPanel>(immersive ? "none" : "write");
  // Entering full screen is a request to watch; leaving it, to write again.
  // Adjusted during render (React's pattern for state that follows a prop).
  const [layout, setLayout] = useState(immersive);
  if (layout !== immersive) {
    setLayout(immersive);
    setPanel(immersive ? "none" : "write");
  }
  const toggle = (next: WatchPanel) => setPanel((p) => (p === next ? "none" : next));

  const writing = (
    <>
      <TerminalInputSwitch
        inputMode={inputMode}
        onInputModeChange={onInputModeChange}
        hide={["voice"]}
      />
      {inputMode === "type" && !liveKeys && (
        <TerminalRawComposer onSend={onKey} sessionLabel={tab} />
      )}
      {inputMode === "type" && liveKeys && (
        <p className="ui-term-dock-hint">
          Live keystrokes are on — tap the screen above, then type. Turn them off in the session
          menu to get the typing box back.
        </p>
      )}
      {inputMode === "prompt" && <TerminalComposer tab={tab} density="compact" />}
      {inputMode === "voice" && (
        <div className="flex items-center justify-center">
          <TabVoiceMic tab={tab} channel={channel} compact={immersive} />
        </div>
      )}
    </>
  );

  return (
    <div className="ui-term-dock md:hidden">
      {panel === "keys" && <TerminalKeyDeck onKey={onKey} />}
      {panel === "write" && writing}
      <div className="ui-term-watchbar" role="toolbar" aria-label="Session controls">
        <button
          type="button"
          className={panel === "keys" ? "ui-chip-toggle-active gap-1.5" : "ui-chip-toggle gap-1.5"}
          aria-pressed={panel === "keys"}
          onClick={() => toggle("keys")}
        >
          <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
          Keys
        </button>
        <button
          type="button"
          className={panel === "write" ? "ui-chip-toggle-active gap-1.5" : "ui-chip-toggle gap-1.5"}
          aria-pressed={panel === "write"}
          onClick={() => toggle("write")}
        >
          <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
          Write
        </button>
        {/* Only while watching: the Keys panel has its own Esc/Enter, and
            beside the composer's Send a second Enter read as the same button. */}
        {panel === "none" && (
          <div className="ml-auto flex items-center gap-1.5">
            <KeyCap keyDef={TERMINAL_KEYS.esc} onKey={onKey} className="ui-term-key" />
            <KeyCap
              keyDef={TERMINAL_KEYS.enter}
              onKey={onKey}
              className="ui-term-key ui-term-key-accent"
            />
          </div>
        )}
      </div>
    </div>
  );
}
