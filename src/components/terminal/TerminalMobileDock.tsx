"use client";

import type { BuilderChannel } from "@/lib/event-stream-types";
import type { TerminalInputMode } from "@/config/terminal-modes";
import { TerminalKeyDeck } from "./TerminalKeyDeck";
import { TerminalRawComposer } from "./TerminalRawComposer";
import { TerminalComposer } from "./TerminalComposer";
import { TabVoiceMic } from "./TabVoiceMic";
import { TerminalInputSwitch } from "./TerminalInputSwitch";

/**
 * Everything below the screen: the keys, then the way you write.
 *
 * The deck is present in all three input modes and that is deliberate. Prompt
 * and Voice send a *task*; the agent answers with a question — "Continue?",
 * "Which of these?", "[✔] scan shell history" — and answering it needs Enter
 * and arrows no matter how the task was dispatched. Modes change how words are
 * delivered; they do not change the fact that a TUI asks yes/no questions.
 */
export function TerminalMobileDock({
  tab,
  channel,
  inputMode,
  onInputModeChange,
  onShowChat,
  suggestions,
  keyboardOpen,
  onKey,
  liveKeys,
  immersive,
}: {
  tab: string;
  channel: BuilderChannel;
  inputMode: TerminalInputMode;
  onInputModeChange: (mode: TerminalInputMode) => void;
  /** Switches to the conversation view; omitted when the agent has none. */
  onShowChat?: () => void;
  /** Prompts that fit the screen, offered above the Prompt box. */
  suggestions?: readonly string[];
  /** The soft keyboard is up. */
  keyboardOpen: boolean;
  /** Verbatim bytes into the session. */
  onKey: (bytes: string) => void;
  /** When on, xterm has the keyboard and the typing box would fight it for
   *  focus — so the deck stands alone. */
  liveKeys: boolean;
  immersive: boolean;
}) {
  return (
    <div className="ui-term-dock md:hidden">
      {/* Writing a task in the Prompt box needs the phone keyboard, not the
          TUI keys — and with both up the screen above was squeezed to nothing.
          The deck returns the moment the keyboard goes down, which is when a
          question on screen gets answered. Type mode keeps it: there the
          arrows and Esc are the point. */}
      {!(keyboardOpen && inputMode === "prompt") && <TerminalKeyDeck onKey={onKey} />}

      {/* Beside the input, not only in the session sheet: Prompt is where a
          screenshot is attached and where you talk, so it is one tap away. */}
      <TerminalInputSwitch
        inputMode={inputMode}
        onInputModeChange={onInputModeChange}
        chat={onShowChat ? { active: false, onSelect: onShowChat } : undefined}
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
      {inputMode === "prompt" && (
        <TerminalComposer tab={tab} density="compact" suggestions={suggestions} />
      )}
      {inputMode === "voice" && (
        <div className="flex items-center justify-center">
          <TabVoiceMic tab={tab} channel={channel} compact={immersive} />
        </div>
      )}
    </div>
  );
}
