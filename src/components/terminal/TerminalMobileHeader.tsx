"use client";

import { ChevronDown, Maximize2, MessagesSquare, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type TerminalLiveState = "live" | "connecting" | "stalled" | "idle";

const DOT_CLASS: Record<TerminalLiveState, string> = {
  live: "ui-term-live-dot ui-term-live-dot-on",
  connecting: "ui-term-live-dot ui-term-live-dot-pending",
  stalled: "ui-term-live-dot ui-term-live-dot-warn",
  idle: "ui-term-live-dot",
};

const STATE_LABEL: Record<TerminalLiveState, string> = {
  live: "live",
  connecting: "connecting",
  stalled: "not responding",
  idle: "no session",
};

/**
 * The whole terminal header, on one line.
 *
 * What it replaced: a page title, a subtitle, a four-pill source strip, a
 * scrolling tab strip, a source select, a session select, an agent button, an
 * input-mode select, a status chip and an expand button — ten controls stacked
 * above a terminal that was left with four visible lines of an eighty-column
 * screen.
 *
 * What survives is what changes minute to minute: which session you are
 * watching, what is running in it, and whether it is alive. Everything else is
 * behind the same tap, in the sheet — one gesture, one place, no hunting.
 */
export function TerminalMobileHeader({
  title,
  agent,
  state,
  onOpenSheet,
  onOpenLoki,
  immersive,
  onToggleImmersive,
}: {
  title: string;
  agent?: string | null;
  state: TerminalLiveState;
  onOpenSheet: () => void;
  /** Opens the Loki commentary/inject sheet — same rail as desktop. */
  onOpenLoki?: () => void;
  immersive: boolean;
  onToggleImmersive: () => void;
}) {
  return (
    <div className="ui-term-mhead">
      <button
        type="button"
        className="ui-term-mhead-btn"
        onClick={onOpenSheet}
        aria-haspopup="dialog"
        aria-label={`${title} — ${STATE_LABEL[state]}. Change session, source or agent`}
      >
        <span
          className={cn(DOT_CLASS[state], "shrink-0")}
          aria-hidden="true"
          title={STATE_LABEL[state]}
        />
        <span className="ui-term-mhead-title">{title}</span>
        {agent && <span className="ui-term-mhead-agent">{agent}</span>}
        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
      </button>

      {onOpenLoki && (
        <button
          type="button"
          className="ui-term-mhead-icon"
          onClick={onOpenLoki}
          aria-label="Loki comments and inject"
        >
          <MessagesSquare className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        className="ui-term-mhead-icon"
        onClick={onToggleImmersive}
        aria-pressed={immersive}
        aria-label={immersive ? "Exit full screen" : "Full screen"}
      >
        {immersive ? (
          <Minimize2 className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
