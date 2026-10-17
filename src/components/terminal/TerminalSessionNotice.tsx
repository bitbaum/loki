"use client";

import { X } from "lucide-react";
import { SESSION_STATUS_WORDS } from "@/lib/terminal-session-status";
import { SESSION_STATUS_DOT } from "./session-status-dot";
import type { useSessionStatuses } from "./use-session-statuses";

/**
 * News from a session you are not looking at, in one line: "substrata 2
 * finished" or "orangecat needs you", with Open beside it. It goes away on its
 * own, when you open that session, or with ×. One at a time — the newest wins —
 * so running five sessions never turns into a wall of alerts.
 */
export function TerminalSessionNotice({
  news,
  tabs,
  onOpen,
}: {
  news: ReturnType<typeof useSessionStatuses>;
  /** The strip's tabs, for the name the person knows the session by. */
  tabs: { id: string; label: string }[];
  onOpen: (tab: string) => void;
}) {
  const { notice, dismissNotice } = news;
  if (!notice) return null;
  const label = tabs.find((t) => t.id === notice.tab)?.label ?? notice.tab;
  return (
    <div className="ui-term-notice" role="status">
      <span className={SESSION_STATUS_DOT[notice.status]} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-text-primary">{label}</span>{" "}
        {SESSION_STATUS_WORDS[notice.status]}
      </span>
      <button
        type="button"
        className="ui-btn-secondary min-h-11 shrink-0"
        onClick={() => onOpen(notice.tab)}
      >
        Open
      </button>
      <button
        type="button"
        className="ui-btn-icon min-h-11 min-w-11 shrink-0"
        onClick={dismissNotice}
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
