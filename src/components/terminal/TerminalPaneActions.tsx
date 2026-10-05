"use client";

import { Maximize2, Minimize2, PanelRight } from "lucide-react";

/**
 * The pane controls at the end of the terminal's status row (desktop): Loki
 * (the panel that summarizes this run and takes Ask/Inject) and full screen.
 * The way to the conversation view is the Chat position of the input switch
 * above the pane — it was also a "Conversation" button here, two controls for
 * one view on one screen.
 *
 * "Loki", not "Chat", matching the phone header: beside a conversation with
 * Claude, a second button called Chat read as the same thing twice.
 */
export function TerminalPaneActions({
  loki,
  immersive,
  onToggleImmersive,
}: {
  /** Omitted when there is no project for the panel to be about. */
  loki?: { shown: boolean; pressable: boolean; onToggle: () => void };
  immersive: boolean;
  onToggleImmersive?: () => void;
}) {
  return (
    <>
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
