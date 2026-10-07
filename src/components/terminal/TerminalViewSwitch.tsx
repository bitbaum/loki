"use client";

import { MessagesSquare, TerminalSquare } from "lucide-react";
import type { TerminalViewMode } from "@/config/terminal-modes";

/** When the session's agent has no name to show. */
const AGENT_FALLBACK = "Chat";

/**
 * Claude | Terminal — how the session is SHOWN. One control holding both
 * choices, drawn in both views, at every width.
 *
 * The first choice is named after the AGENT running in the session, because
 * that is who the conversation view shows you talking to. It was "Loki" for
 * two days (#1041) and that was wrong: Loki is the supervisor that runs on
 * whichever model is first in its chain, and the thing in this session is a
 * coding agent — Claude Code today, Codex tomorrow. Two different AIs under
 * one name was the confusion the operator reported on 2026-10-07: "there can
 * be one model powering the chat, and another model is open in the terminal".
 *
 * It replaced three things: a bare speech-bubble icon in the phone header, a
 * "Conversation" button that existed only inside the terminal pane (so on a
 * laptop the conversation view had no way back), and a "Loki" chip in the
 * phone dock that vanished with the dock the moment it was used.
 */
export function TerminalViewSwitch({
  view,
  onViewChange,
  agentLabel,
}: {
  view: TerminalViewMode;
  onViewChange: (view: TerminalViewMode) => void;
  /** The agent running in this session, as the chooser lists it ("Claude"). */
  agentLabel?: string | null;
}) {
  const agent = agentLabel?.trim() || AGENT_FALLBACK;
  const views = [
    {
      id: "chat",
      label: agent,
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
          title={hint}
          onClick={() => onViewChange(id)}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
