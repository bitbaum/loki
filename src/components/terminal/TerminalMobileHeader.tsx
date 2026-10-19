"use client";

import Link from "next/link";
import { ChevronDown, ChevronLeft, MoreVertical } from "lucide-react";
import type { TerminalViewMode } from "@/config/terminal-modes";
import { cn } from "@/lib/utils";
import { SESSION_STATUS_WORDS, type SessionStatus } from "@/lib/terminal-session-status";
import { SESSION_STATUS_DOT } from "./session-status-dot";
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
 * The phone's header, shaped like every chat app's: back · the conversation's
 * name · ⋮, with how it is shown (Claude | Terminal) as a thin pill under it.
 *
 * What it replaced: a scrolling row of session tabs with a "+" beside it, the
 * view switch stretched to a full-width second row, a full-screen button and,
 * above it all, the app's own top bar and bottom tabs — five bands of chrome
 * around a terminal (owner, 2026-10-19: "spaghetti UI"). The app bars now step
 * aside while a session is open (useImmersiveChat), so "back" is the way out.
 *
 * The name says which session you are in; its second line says what runs it
 * and where, and how many others are open. A tap on it lists them all, with
 * "New session" — the sheet, not a row of tabs that ran off the edge.
 */
export function TerminalMobileHeader({
  title,
  agent,
  state,
  status = null,
  builder,
  sessionCount = 0,
  backHref,
  onOpenSheet,
  onOpenMore,
  view,
  onViewChange,
}: {
  title: string;
  agent?: string | null;
  state: TerminalLiveState;
  /** What the session is doing, once the connection to it is live. */
  status?: SessionStatus | null;
  /** Where it runs, as the sheet names it ("Cloud builder"). */
  builder?: string | null;
  /** Sessions open here, this one included. */
  sessionCount?: number;
  /** Where "back" goes; omitted, there is no back button. */
  backHref?: string;
  onOpenSheet: () => void;
  /** The "⋮" sheet: Loki's read, full screen, display. */
  onOpenMore?: () => void;
  /** Conversation ↔ raw terminal, when the session's agent supports the
   *  conversation view. */
  view?: TerminalViewMode;
  onViewChange?: (view: TerminalViewMode) => void;
}) {
  const dotWords = state === "live" && status ? SESSION_STATUS_WORDS[status] : STATE_LABEL[state];
  const others = sessionCount > 1 ? `${sessionCount} sessions` : null;
  // The count before the builder: at 320px the line truncates, and that
  // there are other sessions is the part a person cannot otherwise see.
  // With no session open the title already IS the builder's name.
  const where =
    builder && builder.toLowerCase() !== title.toLowerCase() ? lowerFirst(builder) : null;
  const subtitle = [agent, others, where].filter(Boolean).join(" · ");
  return (
    <div className="ui-term-mhead">
      <div className="ui-term-mhead-row">
        {backHref ? (
          <Link href={backHref} className="ui-term-mhead-ghost" aria-label="Back to Home">
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
        ) : (
          <span className="ui-term-mhead-ghost" aria-hidden="true" />
        )}
        <button
          type="button"
          className="ui-term-mhead-btn"
          onClick={onOpenSheet}
          aria-haspopup="dialog"
          aria-label={`${title} — ${dotWords}. Sessions, where it runs and the agent`}
        >
          <span className="ui-term-mhead-name">
            <span
              className={cn(
                state === "live" && status ? SESSION_STATUS_DOT[status] : DOT_CLASS[state],
                "shrink-0",
              )}
              aria-hidden="true"
              title={dotWords}
            />
            <span className="ui-term-mhead-title">{title}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
          </span>
          {subtitle && <span className="ui-term-mhead-sub">{subtitle}</span>}
        </button>
        {onOpenMore ? (
          <button
            type="button"
            className="ui-term-mhead-ghost"
            onClick={onOpenMore}
            aria-haspopup="dialog"
            aria-label="More: what's going on, full screen, text size"
          >
            <MoreVertical className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : (
          <span className="ui-term-mhead-ghost" aria-hidden="true" />
        )}
      </div>
      {onViewChange && view && (
        <TerminalViewSwitch view={view} onViewChange={onViewChange} agentLabel={agent} />
      )}
      {/* No feedback button here: the widget's own edge tab is on this page
          (data-fc-place="tab" in (app)/terminal/page.tsx), and a second way to
          the same panel read as a second, unexplained thing. */}
    </div>
  );
}

function lowerFirst(words: string): string {
  return words.charAt(0).toLowerCase() + words.slice(1);
}
