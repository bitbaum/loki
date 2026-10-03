"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, Search, SquarePen, Trash2 } from "lucide-react";
import { LokiPaneBody } from "./LokiPaneBody";
import { shortTimeAgo } from "@/lib/dates";
import { groupConversations, visibleConversationGroups } from "@/lib/loki/conversation-groups";
import type { ConversationSummary } from "./types";

/** Below this, a search box is furniture: you can see every thread already. */
const SEARCH_THRESHOLD = 8;

/**
 * Every thread, in one rail.
 *
 * This replaces a stack of four competing navigations that all led to the same
 * place: the global sidebar, a Chat/Control/Terminal tab strip, a pinned
 * history rail, AND a "Chats / New" toolbar above the transcript. Four controls
 * for two actions — open a thread, start a thread.
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
  onSelect,
  onNew,
  onDelete,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** The thread with a turn in flight, so the rail shows it working. */
  busyId?: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
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

  const groups = groupConversations(filtered, activeId);
  const { visible, hidden } = visibleConversationGroups(groups);
  // Searching means you already know roughly what you want — paging it behind
  // "show older" would hide the match you searched for.
  const shown = expanded || needle ? groups : visible;

  const handleDeleteClick = (id: string) => {
    if (armedId === id) {
      setArmedId(null);
      onDelete(id);
    } else {
      setArmedId(id);
    }
  };

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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <LokiPaneBody loading={loading} error={error} onRetry={onRetry}>
          {conversations.length === 0 ? (
            <p className="ui-loki-rail-empty">No chats yet. Ask something below to start one.</p>
          ) : shown.length === 0 ? (
            <p className="ui-loki-rail-empty">No chat matches “{query}”.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {shown.map(({ head: c, count }) => {
                const armed = armedId === c.id;
                return (
                  <div key={c.id} className="ui-loki-convo-row group/convo">
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      className={`ui-loki-convo pr-10 ${c.id === activeId ? "ui-loki-convo-active" : ""}`}
                    >
                      <div className="ui-loki-convo-title">
                        {c.id === busyId && (
                          <Loader2
                            className="mr-1.5 inline h-3.5 w-3.5 animate-spin align-[-2px]"
                            aria-label="Working"
                          />
                        )}
                        {c.title}
                      </div>
                      {c.preview && <div className="ui-loki-convo-preview">{c.preview}</div>}
                      <div className="ui-loki-convo-meta">
                        {[
                          c.projectKeys.join(", "),
                          shortTimeAgo(Date.parse(c.updatedAt)),
                          count > 1 ? `×${count}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </button>
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
              })}
              {!expanded && !needle && hidden > 0 && (
                <button
                  type="button"
                  className="ui-loki-rail-more"
                  onClick={() => setExpanded(true)}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden /> {hidden} older
                </button>
              )}
            </div>
          )}
        </LokiPaneBody>
      </div>
    </div>
  );
}
