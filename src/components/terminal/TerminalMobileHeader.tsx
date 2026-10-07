"use client";

import { ChevronDown, Maximize2, MessageSquareWarning, Minimize2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { openFeedback } from "@/lib/open-feedback";
import type { TerminalViewMode } from "@/config/terminal-modes";
import { cn } from "@/lib/utils";
import { TerminalViewSwitch } from "./TerminalViewSwitch";

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
  immersive,
  onToggleImmersive,
  view,
  onViewChange,
}: {
  title: string;
  agent?: string | null;
  state: TerminalLiveState;
  onOpenSheet: () => void;
  immersive: boolean;
  onToggleImmersive: () => void;
  /** Conversation ↔ raw terminal, when the session's agent supports the
   *  conversation view. */
  view?: TerminalViewMode;
  onViewChange?: (view: TerminalViewMode) => void;
}) {
  const router = useRouter();
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
        {/* Where the view switch is drawn it already carries the agent's
            name, and it needs the width — the chip cost the session name its
            letters ("derho…" at 390px). */}
        {agent && !onViewChange && <span className="ui-term-mhead-agent">{agent}</span>}
        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
      </button>

      {onViewChange && view && (
        <TerminalViewSwitch view={view} onViewChange={onViewChange} agentLabel={agent} />
      )}
      {/* The feedback widget's floating button is hidden on this page (it would
          cover the terminal and the composer — terminal/page.tsx), so it opens
          from here: report a problem, point at an element, attach a screenshot. */}
      <button
        type="button"
        className="ui-term-mhead-icon"
        onClick={() => openFeedback(() => router.push("/support"))}
        aria-label="Feedback on this page — point at anything or attach a screenshot"
        title="Feedback"
      >
        <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />
      </button>
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
