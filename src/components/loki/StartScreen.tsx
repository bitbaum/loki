"use client";

import { shortTimeAgo } from "@/lib/dates";
import type { ConversationSummary } from "./types";

/** Threads listed before "All chats". The list scrolls above the docked
 *  composer, so this is a reading budget, not a fit-on-screen limit. */
const RESUME_LIMIT = 8;

/**
 * What a fresh /loki shows.
 *
 * The old start screen was a headline, a subtitle and one orange button
 * floating in roughly a thousand pixels of empty grey — measured on a
 * 2340px-tall phone, ~600px above and ~400px below. Emptiness is not calm when
 * the operator already has work in flight.
 *
 * So the space goes to the only thing that is both true and useful before a
 * word is typed: the threads you were last in, one tap from resuming. With
 * nothing to resume it says one line and gets out of the way — the composer's
 * own starter chips carry the first run.
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
  // Offering the same four threads twice, side by side, is the problem this
  // rebuild set out to remove — it is the old four-navigations-for-two-actions
  // bug in a new place. When the rail is open it owns resuming, and the start
  // screen is just the greeting over the composer.
  const recent = railVisible ? [] : conversations.slice(0, RESUME_LIMIT);

  // Nothing is rendered while the list is still unknown. A greeting that
  // appears and is immediately shoved up the screen by four rows is worse than
  // a beat of nothing.
  if (loading && conversations.length === 0) return null;

  return (
    // With chats to list, the list reads top-down like a messages inbox; with
    // none, the one-line greeting stays down by the composer it introduces.
    <div className={recent.length > 0 ? "ui-loki-start ui-loki-start-inbox" : "ui-loki-start"}>
      <h1 className="ui-loki-start-title">
        {recent.length > 0 ? "Chats" : "What are we working on?"}
      </h1>

      {recent.length > 0 && (
        <ul className="ui-loki-start-list">
          {recent.map((convo) => (
            <li key={convo.id}>
              <button
                type="button"
                className="ui-loki-start-row"
                onClick={() => onResume(convo.id)}
              >
                {/* Like a contact in a messages list: who (the project) at a
                    glance, then the thread, then when. */}
                <span className="ui-loki-start-avatar" aria-hidden>
                  {(convo.projectKeys[0] ?? convo.title).slice(0, 1).toUpperCase()}
                </span>
                <span className="ui-loki-start-row-text">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="ui-loki-start-row-title">{convo.title}</span>
                    <span className="ui-loki-start-row-time">
                      {shortTimeAgo(Date.parse(convo.updatedAt))}
                    </span>
                  </span>
                  <span className="ui-loki-start-row-meta">
                    {convo.projectKeys.length > 0 ? convo.projectKeys.join(" · ") : "No project"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!railVisible && conversations.length > RESUME_LIMIT && (
        <button type="button" className="ui-loki-start-more" onClick={onBrowseAll}>
          All {conversations.length} chats
        </button>
      )}
    </div>
  );
}
