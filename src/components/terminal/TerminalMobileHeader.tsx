"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, Maximize2, Minimize2, Plus } from "lucide-react";
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
 * The session name stays readable; on phones the view choices get their own row.
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
 *
 * With more than one session the name becomes a row of them, like the tabs of
 * a terminal: the one you are in keeps its dot and its chevron (and still
 * opens the sheet), the others switch with one tap, and "+" starts another.
 * One session looks exactly as it did, plus the "+".
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
  sessions,
  activeSession,
  onSelectSession,
  onNewSession,
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
  /** Every open session, in the order the strip shows them. */
  sessions?: { id: string; label: string; status?: SessionStatus | null }[];
  activeSession?: string | null;
  onSelectSession?: (id: string) => void;
  /** Opens the start-a-session sheet. */
  onNewSession?: () => void;
}) {
  const ordered = sessions ?? [];
  const tabbed =
    Boolean(onSelectSession) && ordered.length > 1 && ordered.some((s) => s.id === activeSession);
  // What the session you are in is doing, once the connection to it is live.
  const currentStatus = ordered.find((s) => s.id === activeSession)?.status ?? null;
  // Keep the session you are in on screen when the row scrolls.
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (tabbed) activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tabbed, activeSession]);
  const current = (
    <button
      ref={activeRef}
      type="button"
      className={cn("ui-term-mhead-btn", tabbed && "ui-term-mhead-btn-tab")}
      onClick={onOpenSheet}
      aria-haspopup="dialog"
      aria-label={`${title} — ${STATE_LABEL[state]}. Change session, source or agent`}
    >
      <span
        className={cn(
          state === "live" && currentStatus ? SESSION_STATUS_DOT[currentStatus] : DOT_CLASS[state],
          "shrink-0",
        )}
        aria-hidden="true"
        title={
          state === "live" && currentStatus
            ? SESSION_STATUS_WORDS[currentStatus]
            : STATE_LABEL[state]
        }
      />
      <span className="ui-term-mhead-title">{title}</span>
      {/* Where the view switch is drawn it already carries the agent's
            name, and it needs the width — the chip cost the session name its
            letters ("derho…" at 390px). */}
      {agent && !onViewChange && <span className="ui-term-mhead-agent">{agent}</span>}
      <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
    </button>
  );
  return (
    <div className="ui-term-mhead">
      {/* The sessions and the "+" that starts another scroll together, so a
          narrow phone gives the names every column the icons do not need. */}
      <div className={cn("ui-term-mtabs", !tabbed && "overflow-visible")} aria-label="Sessions">
        {tabbed
          ? ordered.map((s) =>
              s.id === activeSession ? (
                <span key={s.id} className="contents">
                  {current}
                </span>
              ) : (
                <button
                  key={s.id}
                  type="button"
                  className="ui-term-mtab"
                  onClick={() => onSelectSession?.(s.id)}
                  aria-label={`Switch to ${s.label}${s.status ? ` — ${SESSION_STATUS_WORDS[s.status]}` : ""}`}
                  title={s.status ? SESSION_STATUS_WORDS[s.status] : undefined}
                >
                  {s.status && <span className={SESSION_STATUS_DOT[s.status]} aria-hidden="true" />}
                  <span className="truncate">{s.label}</span>
                </button>
              ),
            )
          : current}
      </div>
      {/* Outside the scrolling row: with two sessions open it scrolled off the
          right edge and read as missing (owner, 2026-10-19). The row keeps
          the width it has; "+" keeps its place. */}
      {onNewSession && (
        <button
          type="button"
          className="ui-term-mhead-icon"
          onClick={onNewSession}
          aria-haspopup="dialog"
          aria-label="New session"
          title="New session"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      )}

      {onViewChange && view && (
        <TerminalViewSwitch view={view} onViewChange={onViewChange} agentLabel={agent} />
      )}
      {/* No feedback button here: the widget's own edge tab is on this page
          (data-fc-place="tab" in (app)/terminal/page.tsx), and a second way to
          the same panel read as a second, unexplained thing. */}
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
