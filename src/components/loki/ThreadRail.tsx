"use client";

import { useMemo, useState } from "react";
import { Loader2, Pin, PinOff, Plus, Search, SquarePen, Trash2 } from "lucide-react";
import { LokiPaneBody } from "./LokiPaneBody";
import { shortTimeAgo } from "@/lib/dates";
import { groupConversations, visibleConversationGroups } from "@/lib/loki/conversation-groups";
import {
  deriveThreadState,
  groupThreadsByProject,
  sortThreads,
  type ThreadStateInput,
  type ThreadStateKind,
} from "@/lib/loki/thread-state";
import type { ConversationSummary } from "./types";

/** Below this, a search box is furniture: you can see every thread already. */
const SEARCH_THRESHOLD = 8;

/** Below this, a by-project view is one header over everything. */
const GROUP_THRESHOLD = 2;

export type RailMode = "recent" | "project";

/** A summary row as the state module reads it (undefined → unknown → quiet). */
export function stateInputOf(c: ConversationSummary): ThreadStateInput {
  return {
    lastRole: c.lastRole ?? null,
    lastKind: c.lastKind ?? null,
    lastAt: c.lastAt ?? null,
    lastOk: c.lastOk ?? null,
    lastOutcome: c.lastOutcome ?? null,
    lastNeedsProject: c.lastNeedsProject ?? null,
    lastReadAt: c.lastReadAt ?? null,
  };
}

const DOT_CLASS: Record<ThreadStateKind, string | null> = {
  "needs-you": "ui-dot ui-dot-warning",
  running: null,
  done: "ui-dot ui-dot-positive",
  unread: "ui-dot ui-dot-positive",
  quiet: null,
};

/**
 * Every thread, in one rail — as an inbox, not a history.
 *
 * This replaces a stack of four competing navigations that all led to the same
 * place: the global sidebar, a Chat/Control/Terminal tab strip, a pinned
 * history rail, AND a "Chats / New" toolbar above the transcript. Four controls
 * for two actions — open a thread, start a thread.
 *
 * Each row now says what the thread needs from you — a project pick, a look
 * at a run that failed, a run that finished while you were away, nothing —
 * and the rail sorts by that before recency (lib/loki/thread-state.ts). A
 * person running a dozen projects opens the rail to answer "what needs me",
 * which a list ordered only by last touch cannot answer. Pinned threads
 * stay on top; "By project" folds the same rows under one header per
 * project, with that project's counts.
 *
 * Same-work threads stay collapsed (`groupConversations`): "move forward on
 * loki" fifteen times is one row with a count, not fifteen rows that
 * read identically.
 */
export function ThreadRail({
  conversations,
  activeId,
  loading,
  error,
  onRetry,
  busyId = null,
  mode = "recent",
  onModeChange,
  onSelect,
  onNew,
  onDelete,
  onPin,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** The thread with a turn in flight, so the rail shows it working. */
  busyId?: string | null;
  mode?: RailMode;
  onModeChange?: (mode: RailMode) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onPin?: (id: string, pinned: boolean) => void;
}) {
  const [armedId, setArmedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      needle
        ? conversations.filter(
            (c) =>
              c.title.toLowerCase().includes(needle) ||
              c.projectKeys.some((k) => k.toLowerCase().includes(needle)),
          )
        : conversations,
    [conversations, needle],
  );
  const rows = useMemo(() => filtered.map((c) => ({ ...c, ...stateInputOf(c) })), [filtered]);

  const handleDeleteClick = (id: string) => {
    if (armedId === id) {
      setArmedId(null);
      onDelete(id);
    } else {
      setArmedId(id);
    }
  };

  const projectCount = new Set(conversations.map((c) => c.projectKeys[0] ?? "")).size;
  const byProject = mode === "project" && projectCount >= GROUP_THRESHOLD && !needle;

  const renderRow = (c: (typeof rows)[number], count: number) => {
    const armed = armedId === c.id;
    const state = deriveThreadState(c);
    const running = c.id === busyId || state.kind === "running";
    const dot = DOT_CLASS[state.kind];
    const projectLabel = byProject ? null : c.projectKeys.join(", ");
    return (
      <div key={c.id} className="ui-loki-convo-row group/convo">
        <button
          type="button"
          onClick={() => onSelect(c.id)}
          className={`ui-loki-convo ${onPin ? "pr-20" : "pr-10"} ${c.id === activeId ? "ui-loki-convo-active" : ""}`}
        >
          <div className="ui-loki-convo-title">
            {c.pinnedAt && <Pin className="ui-loki-convo-pinned" aria-label="Pinned" />}
            {c.title}
          </div>
          {c.preview && <div className="ui-loki-convo-preview">{c.preview}</div>}
          <div className="ui-loki-convo-meta">
            {(running || dot || state.label) && (
              <span
                className={
                  state.kind === "needs-you"
                    ? "ui-loki-convo-state ui-loki-convo-state-needs"
                    : "ui-loki-convo-state"
                }
              >
                {running ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
                ) : (
                  dot && <span className={dot} aria-hidden />
                )}
                {running && c.id === busyId ? "Working" : state.label}
              </span>
            )}
            {[projectLabel, shortTimeAgo(Date.parse(c.updatedAt)), count > 1 ? `×${count}` : null]
              .filter(Boolean)
              .map((part, i) => (
                <span key={i}>{part}</span>
              ))}
          </div>
        </button>
        {onPin && (
          <button
            type="button"
            onClick={() => onPin(c.id, !c.pinnedAt)}
            aria-label={c.pinnedAt ? `Unpin ${c.title}` : `Pin ${c.title}`}
            title={c.pinnedAt ? "Unpin" : "Pin to the top"}
            className="ui-loki-convo-pin group-hover/convo:opacity-100"
          >
            {c.pinnedAt ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={() => handleDeleteClick(c.id)}
          onBlur={() => armed && setArmedId(null)}
          aria-label={armed ? `Confirm delete ${c.title}` : `Delete ${c.title}`}
          title={armed ? "Click again to delete" : "Delete conversation"}
          className={`ui-loki-convo-delete group-hover/convo:opacity-100 ${armed ? "ui-loki-convo-delete-armed" : ""}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    );
  };

  let body: React.ReactNode;
  if (conversations.length === 0) {
    body = <p className="ui-loki-rail-empty">No chats yet. Ask something below to start one.</p>;
  } else if (rows.length === 0) {
    body = <p className="ui-loki-rail-empty">No chat matches “{query}”.</p>;
  } else if (byProject) {
    body = (
      <div className="flex flex-col gap-2">
        {groupThreadsByProject(rows).map((group) => {
          const parts = [
            group.counts.needsYou > 0
              ? `${group.counts.needsYou} need${group.counts.needsYou === 1 ? "s" : ""} you`
              : null,
            group.counts.running > 0 ? `${group.counts.running} running` : null,
          ].filter(Boolean);
          return (
            <section key={group.project} aria-label={group.project}>
              <h3 className="ui-loki-rail-group">
                <span className="truncate">{group.project}</span>
                {parts.length > 0 && (
                  <span className="ui-loki-rail-group-counts">{parts.join(" · ")}</span>
                )}
              </h3>
              <div className="flex flex-col gap-0.5">
                {groupConversations(group.threads, activeId).map(({ head, count }) =>
                  renderRow(head, count),
                )}
              </div>
            </section>
          );
        })}
      </div>
    );
  } else {
    const groups = groupConversations(sortThreads(rows), activeId);
    const { visible, hidden } = visibleConversationGroups(groups);
    // Searching means you already know roughly what you want — paging it
    // behind "show older" would hide the match you searched for.
    const shown = expanded || needle ? groups : visible;
    body = (
      <div className="flex flex-col gap-0.5">
        {shown.map(({ head, count }) => renderRow(head, count))}
        {!expanded && !needle && hidden > 0 && (
          <button type="button" className="ui-loki-rail-more" onClick={() => setExpanded(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> {hidden} older
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="ui-loki-rail">
      <button type="button" className="ui-loki-rail-new" onClick={onNew}>
        <SquarePen className="h-4 w-4 shrink-0" aria-hidden />
        <span>New chat</span>
      </button>

      {conversations.length >= SEARCH_THRESHOLD && (
        <div className="ui-loki-rail-search">
          <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="ui-loki-rail-search-input"
          />
        </div>
      )}

      {onModeChange && projectCount >= GROUP_THRESHOLD && (
        <div className="ui-loki-rail-modes" role="group" aria-label="Order chats">
          {(
            [
              ["recent", "What needs me"],
              ["project", "By project"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={
                mode === value ? "ui-loki-rail-mode ui-loki-rail-mode-on" : "ui-loki-rail-mode"
              }
              aria-pressed={mode === value}
              onClick={() => onModeChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <LokiPaneBody loading={loading} error={error} onRetry={onRetry}>
          {body}
        </LokiPaneBody>
      </div>
    </div>
  );
}
