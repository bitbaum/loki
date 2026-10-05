"use client";

import { Maximize2, Minimize2, PanelRight } from "lucide-react";

/**
 * The pane controls at the end of the terminal's status row (desktop):
 * Summary (the panel that summarizes this run and takes Ask/Inject) and full
 * screen.
 *
 * "Summary", not "Loki": "Loki" is the conversation view in the session bar's
 * Loki | Terminal switch, and one word naming two things is what made this
 * screen hard to find your way around.
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
          aria-label={loki.shown ? "Hide the summary panel" : "Show the summary panel"}
          title={
            loki.shown
              ? "Hide the summary — the terminal takes the width"
              : "Summarize this run and ask Loki about it"
          }
        >
          <PanelRight className="h-3.5 w-3.5" aria-hidden="true" />
          Summary
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
