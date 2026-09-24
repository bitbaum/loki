"use client";

import type { BuilderChannel } from "@/lib/event-stream-types";
import type { TerminalInputMode } from "@/config/terminal-modes";
import { TerminalKeyDeck } from "./TerminalKeyDeck";
import { TerminalRawComposer } from "./TerminalRawComposer";
import { TerminalComposer } from "./TerminalComposer";
import { TabVoiceMic } from "./TabVoiceMic";

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
  onKey,
  liveKeys,
  immersive,
}: {
  tab: string;
  channel: BuilderChannel;
  inputMode: TerminalInputMode;
  /** Verbatim bytes into the session. */
  onKey: (bytes: string) => void;
  /** When on, xterm has the keyboard and the typing box would fight it for
   *  focus — so the deck stands alone. */
  liveKeys: boolean;
  immersive: boolean;
}) {
  return (
    <div className="ui-term-dock md:hidden">
      <TerminalKeyDeck onKey={onKey} />

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
    </div>
  );
}
