"use client";

import { Maximize2, Minimize2, PanelRight } from "lucide-react";
import { ChatViewButton } from "./ClaudeChatView";

/**
 * The pane controls at the end of the terminal's status row (desktop):
 * Conversation (the Claude session as messages), Loki (the panel that
 * summarizes this run and takes Ask/Inject), and full screen.
 *
 * "Loki", not "Chat", matching the phone header: beside a conversation with
 * Claude, a second button called Chat read as the same thing twice.
 */
export function TerminalPaneActions({
  onShowConversation,
  loki,
  immersive,
  onToggleImmersive,
}: {
  /** Omitted when the session's agent has no conversation view. */
  onShowConversation?: () => void;
  /** Omitted when there is no project for the panel to be about. */
  loki?: { shown: boolean; pressable: boolean; onToggle: () => void };
  immersive: boolean;
  onToggleImmersive?: () => void;
}) {
  return (
    <>
      {onShowConversation && <ChatViewButton onClick={onShowConversation} />}
      {loki && !immersive && (
        <button
          type="button"
          className={loki.shown ? "ui-term-pane-btn ui-term-pane-btn-on" : "ui-term-pane-btn"}
          onClick={loki.onToggle}
          aria-pressed={loki.pressable ? loki.shown : undefined}
          aria-label={loki.shown ? "Hide the Loki panel" : "Show the Loki panel"}
          title={
            loki.shown
              ? "Hide the Loki panel — the terminal takes the width"
              : "Summarize this run and ask Loki about it"
          }
        >
          <PanelRight className="h-3.5 w-3.5" aria-hidden="true" />
          Loki
        </button>
      )}
      {onToggleImmersive && (
        <button
          type="button"
          className={immersive ? "ui-term-pane-btn ui-term-pane-btn-on" : "ui-term-pane-btn"}
          onClick={onToggleImmersive}
          aria-pressed={immersive}
          aria-label={immersive ? "Leave full screen (Esc)" : "Expand terminal to full screen"}
          title={immersive ? "Leave full screen (Esc)" : "Expand to full screen"}
        >
          {immersive ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      )}
    </>
  );
}
