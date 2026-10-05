"use client";

import { MessagesSquare, TerminalSquare } from "lucide-react";
import type { TerminalViewMode } from "@/config/terminal-modes";

const VIEWS = [
  {
    id: "chat",
    label: "Loki",
    Icon: MessagesSquare,
    hint: "The session as a conversation — messages, not a terminal screen",
  },
  { id: "terminal", label: "Terminal", Icon: TerminalSquare, hint: "The raw terminal screen" },
] satisfies { id: TerminalViewMode; label: string; Icon: typeof MessagesSquare; hint: string }[];

/**
 * Loki | Terminal — how the session is SHOWN. One control holding both choices,
 * drawn in both views, at every width.
 *
 * It replaced three things: a bare speech-bubble icon in the phone header, a
 * "Conversation" button that existed only inside the terminal pane (so on a
 * laptop the conversation view had no way back), and a "Loki" chip in the
 * phone dock that vanished with the dock the moment it was used. Operator,
 * 2026-10-05: "Switch to Loki would show it as a loki session".
 */
export function TerminalViewSwitch({
  view,
  onViewChange,
}: {
  view: TerminalViewMode;
  onViewChange: (view: TerminalViewMode) => void;
}) {
  return (
    <div className="ui-term-views" role="group" aria-label="Show this session as">
      {VIEWS.map(({ id, label, Icon, hint }) => (
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
