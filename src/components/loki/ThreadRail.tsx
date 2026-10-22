"use client";

import { useMemo, useState } from "react";
import { Loader2, MessageSquare, Pin, PinOff, SquarePen, Trash2 } from "lucide-react";
import { LokiPaneBody } from "./LokiPaneBody";
import { shortTimeAgo } from "@/lib/dates";
import { projectTitle } from "@/lib/project-display";
import { groupConversations, visibleConversationGroups } from "@/lib/loki/conversation-groups";
import {
  deriveThreadState,
  groupThreadsByProject,
  sortThreads,
  type ThreadStateInput,
} from "@/lib/loki/thread-state";
import { List, ListRow, ListSearch } from "@/components/ui/list-row";
import { RowActions } from "@/components/ui/row-actions";
import { SectionHeading } from "@/components/ui/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import type { ConversationSummary } from "./types";
import { filterByQuery, type SearchSpec } from "@/lib/search";

/** "Search chats": the title, then the projects a chat was about. */
const CHAT_SEARCH_SPEC: SearchSpec<ConversationSummary> = {
  fields: [
    { name: "title", get: (c) => c.title },
    { name: "projects", get: (c) => c.projectKeys },
  ],
};

/** Below this, a search box is furniture: you can see every thread already. */
const SEARCH_THRESHOLD = 8;

/** Below this, a by-project view is one header over everything. */
const GROUP_THRESHOLD = 2;

export type RailMode = "recent" | "project";

const MODES = [
  { id: "recent", label: "Needs me first" },
  { id: "project", label: "By project" },
];

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

/**
 * Every chat, as a list — Claude's chat list, row for row: the title, one grey
 * line, the time on the right, and the rest in the row's own "…".
 *
 * Each row's grey line says what the thread needs from you first — a project
 * pick, a run that failed, a run that finished while you were away — then
 * which project it is about; the rail sorts by that before recency
 * (lib/loki/thread-state.ts), because a person running a dozen projects opens
 * it to answer "what needs me". Pinned threads stay on top; "By project" folds
 * the same rows under one heading per project.
 *
 * It used to draw a pin and a bin on every row — on a phone, where nothing
 * hovers, forty icons down the right edge (owner, 2026-10-21) — and a
 * two-line title, a preview and a meta line per row. Same-work threads stay
 * collapsed (`groupConversations`): "move forward on loki" fifteen times is
 * one row, not fifteen that read identically.
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
  // Matches stay in the rail's recency order; a slip in a word still matches.
  const filtered = useMemo(
    () => filterByQuery(conversations, CHAT_SEARCH_SPEC, needle),
    [conversations, needle],
  );
  const rows = useMemo(() => filtered.map((c) => ({ ...c, ...stateInputOf(c) })), [filtered]);

  const projectCount = new Set(conversations.map((c) => c.projectKeys[0] ?? "")).size;
  const byProject = mode === "project" && projectCount >= GROUP_THRESHOLD && !needle;

  const renderRow = (c: (typeof rows)[number], count: number) => {
    const armed = armedId === c.id;
    const state = deriveThreadState(c);
    const running = c.id === busyId || state.kind === "running";
    const project = byProject ? null : c.projectKeys[0];
    const stateWord = running && c.id === busyId ? "Working" : state.label;
    const line = [
      stateWord || null,
      project ? projectTitle({ name: project }) : null,
      count > 1 ? `${count} alike` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <ListRow
        key={c.id}
        onClick={() => onSelect(c.id)}
        className={c.id === activeId ? "ui-loki-convo-active" : undefined}
        title={
          <>
            {c.pinnedAt && <Pin className="ui-loki-convo-pinned" aria-label="Pinned" />}
            {c.title}
          </>
        }
        secondary={
          running ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
              <span className="truncate">{line || "Running"}</span>
            </span>
          ) : (
            line || undefined
          )
        }
        status={state.kind === "needs-you" ? "warning" : undefined}
        trailing={shortTimeAgo(Date.parse(c.updatedAt))}
        menu={
          <RowActions label={`More for ${c.title}`}>
            {onPin && (
              <button
                type="button"
                role="menuitem"
                className="ui-menu-item"
                onClick={() => onPin(c.id, !c.pinnedAt)}
              >
                {c.pinnedAt ? (
                  <PinOff className="h-4 w-4" aria-hidden />
                ) : (
                  <Pin className="h-4 w-4" aria-hidden />
                )}
                {c.pinnedAt ? "Unpin" : "Pin to the top"}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="ui-menu-item ui-menu-item-danger"
              onClick={(e) => {
                // The first tap arms in place: the menu stays open to ask.
                if (!armed) {
                  e.stopPropagation();
                  setArmedId(c.id);
                  return;
                }
                setArmedId(null);
                onDelete(c.id);
              }}
              onBlur={() => armed && setArmedId(null)}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              {armed ? "Tap again to delete" : "Delete"}
            </button>
          </RowActions>
        }
      />
    );
  };

  let body: React.ReactNode;
  if (conversations.length === 0) {
    body = <EmptyState icon={MessageSquare} title="No chats yet" size="sm" />;
  } else if (rows.length === 0) {
    body = <EmptyState>No chat matches “{query}”.</EmptyState>;
  } else if (byProject) {
    body = (
      <div className="flex flex-col gap-4">
        {groupThreadsByProject(rows).map((group) => {
          const parts = [
            group.counts.needsYou > 0
              ? `${group.counts.needsYou} need${group.counts.needsYou === 1 ? "s" : ""} you`
              : null,
            group.counts.running > 0 ? `${group.counts.running} running` : null,
          ].filter(Boolean);
          return (
            <section key={group.project} aria-label={group.project}>
              <SectionHeading
                as="h3"
                title={projectTitle({ name: group.project })}
                right={
                  parts.length > 0 ? (
                    <span className="ui-loki-rail-group-counts">{parts.join(" · ")}</span>
                  ) : undefined
                }
              />
              <List>
                {groupConversations(group.threads, activeId).map(({ head, count }) =>
                  renderRow(head, count),
                )}
              </List>
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
      <>
        <List aria-label="Chats">{shown.map(({ head, count }) => renderRow(head, count))}</List>
        {!expanded && !needle && hidden > 0 && (
          <button type="button" className="ui-loki-rail-more" onClick={() => setExpanded(true)}>
            Show {hidden} older
          </button>
        )}
      </>
    );
  }

  return (
    <div className="ui-loki-rail">
      <button type="button" className="ui-loki-rail-new" onClick={onNew}>
        <SquarePen className="h-5 w-5 shrink-0" aria-hidden />
        <span>New chat</span>
      </button>

      <div className="ui-loki-rail-scroll">
        {conversations.length >= SEARCH_THRESHOLD && (
          <ListSearch value={query} onChange={setQuery} placeholder="Search chats" />
        )}
        {onModeChange && projectCount >= GROUP_THRESHOLD && !needle && (
          <div className="mb-2">
            <Segmented
              label="Order chats"
              options={MODES}
              value={mode}
              onChange={(id) => onModeChange(id as RailMode)}
            />
          </div>
        )}
        <LokiPaneBody loading={loading} error={error} onRetry={onRetry}>
          {body}
        </LokiPaneBody>
      </div>
    </div>
  );
}
