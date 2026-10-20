"use client";

import { MessagesSquare, TerminalSquare } from "lucide-react";
import type { TerminalViewMode } from "@/config/terminal-modes";

/**
 * Chat | Terminal — how the session is SHOWN. One control holding both
 * choices, drawn in both views, at every width.
 *
 * Both are named for what you SEE, never for who is running: the agent is
 * already named once, under the session's name in the header ("Claude ·
 * cloud builder"). The first choice was named after the agent until
 * 2026-10-19, so the page read "Terminal" over a pill reading "Claude |
 * Terminal" — two kinds of word side by side, and a person running Grok
 * could not tell whether it would say Grok (owner: "it doesn't really say
 * much"). An agent with no chat view (Grok, Codex today) gets no switch at
 * all: the terminal is the only way it can be shown.
 *
 * Tapping the view you are already in flips to the other one, so every tap
 * changes the screen. As a plain segmented control a second tap on
 * "Terminal" did nothing at all, which was reported (2026-10-20) as a
 * Terminal button that does not toggle the terminal pane.
 */
export function TerminalViewSwitch({
  view,
  onViewChange,
  agentLabel,
}: {
  view: TerminalViewMode;
  onViewChange: (view: TerminalViewMode) => void;
  /** The agent running in this session ("Claude"), for the hint only. */
  agentLabel?: string | null;
}) {
  const agent = agentLabel?.trim() || "the agent";
  const views = [
    {
      id: "chat",
      label: "Chat",
      Icon: MessagesSquare,
      hint: `Talk to ${agent} — the session as messages, not a terminal screen`,
    },
    { id: "terminal", label: "Terminal", Icon: TerminalSquare, hint: "The raw terminal screen" },
  ] satisfies { id: TerminalViewMode; label: string; Icon: typeof MessagesSquare; hint: string }[];
  return (
    <div className="ui-term-views" role="group" aria-label="Show this session as">
      {views.map(({ id, label, Icon, hint }) => (
        <button
          key={id}
          type="button"
          className={view === id ? "ui-term-view-active" : "ui-term-view"}
          aria-pressed={view === id}
          title={view === id ? `${hint} — tap again to switch back` : hint}
          onClick={() => onViewChange(view === id ? other(id) : id)}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

function other(view: TerminalViewMode): TerminalViewMode {
  return view === "chat" ? "terminal" : "chat";
}
