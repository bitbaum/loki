"use client";

import { shortTimeAgo } from "@/lib/dates";
import { BrandMark } from "@/components/shell/BrandMark";
import type { ConversationSummary } from "./types";

/** Threads offered for resuming. Four one-line rows fit above the composer on a
 *  390px phone without pushing the greeting off-screen; the rest are one tap
 *  away in "All chats". */
const RESUME_LIMIT = 4;

/**
 * What a fresh /loki shows: Loki's spiral and one question in the free space,
 * then the few threads you were last in, right above the composer.
 *
 * It used to be a "Chats" heading over eight full-height rows — an inbox that
 * pushed the composer's purpose out of the first screen and read as a second
 * history page. The rail and the drawer already ARE the history; this screen
 * is a beginning, with a short way back into what was in flight.
 */
export function StartScreen({
  conversations,
  loading,
  onResume,
  onBrowseAll,
  railVisible,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
  onResume: (id: string) => void;
  onBrowseAll: () => void;
  /** The rail is already on screen, listing these very threads. */
  railVisible: boolean;
}) {
  // When the rail is open it owns resuming — the same threads twice side by
  // side is noise.
  const recent = railVisible ? [] : conversations.slice(0, RESUME_LIMIT);

  // Nothing is rendered while the list is still unknown, so the greeting does
  // not jump when the rows arrive.
  if (loading && conversations.length === 0) return null;

  return (
    <div className="ui-loki-start">
      <div className="ui-loki-start-hello">
        <BrandMark showWordmark={false} />
        <h1 className="ui-loki-start-title">What are we working on?</h1>
      </div>

      {recent.length > 0 && (
        <nav aria-label="Recent chats" className="ui-loki-start-recent">
          <div className="ui-loki-start-recent-head">
            <span className="ui-micro-label">Recent</span>
            {conversations.length > RESUME_LIMIT && (
              <button type="button" className="ui-loki-start-more" onClick={onBrowseAll}>
                All {conversations.length}
              </button>
            )}
          </div>
          <ul className="ui-loki-start-list">
            {recent.map((convo) => (
              <li key={convo.id}>
                <button
                  type="button"
                  className="ui-loki-start-row"
                  onClick={() => onResume(convo.id)}
                >
                  <span className="ui-loki-start-avatar" aria-hidden>
                    {(convo.projectKeys[0] ?? convo.title).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="ui-loki-start-row-title">{convo.title}</span>
                  <span className="ui-loki-start-row-meta">{convo.projectKeys[0] ?? ""}</span>
                  <span className="ui-loki-start-row-time">
                    {shortTimeAgo(Date.parse(convo.updatedAt))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
