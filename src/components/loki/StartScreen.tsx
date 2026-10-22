"use client";

import { shortTimeAgo } from "@/lib/dates";
import { projectTitle } from "@/lib/project-display";
import { BrandMark } from "@/components/shell/BrandMark";
import { List, ListRow, RowInitial } from "@/components/ui/list-row";
import { SectionHeading } from "@/components/ui/section-heading";
import { BuildSuggestions } from "./BuildSuggestions";
import { ThreadInbox } from "./ThreadInbox";
import type { ConversationSummary } from "./types";

/** Threads offered for resuming. Three rows and two suggestions fit between
 *  the greeting and the composer on a 390×844 phone; the rest of the chats are
 *  one tap away in "All". */
const RESUME_LIMIT = 3;

/**
 * What a fresh /loki shows — the empty chat of the apps the owner uses every
 * day (Claude, ChatGPT, Grok): a greeting, a few rows, the box.
 *
 * It had grown a "start my day" card, a "welcome back" card, a recent list
 * with a project column, a horizontally scrolling strip of suggestion chips
 * with its scrollbar showing, and three starter chips over the composer
 * (owner, 2026-10-21: "poorly designed … makes me look bad"). Both cards are
 * Home's and Today's, where they still are; the suggestions are rows; the
 * starters are gone — "Build next" answers "what should I do" from the
 * person's own records, which a generic "What needs me" chip only asked.
 */
export function StartScreen({
  conversations,
  loading,
  onResume,
  onBrowseAll,
  onBuild,
  railVisible,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
  onResume: (id: string) => void;
  onBrowseAll: () => void;
  /** A "Build next" suggestion was tapped: send it, scoped to its project. */
  onBuild: (prompt: string, project: string | null) => void;
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
      {/* One line of truth above the greeting: what needs you, what runs,
          what came back while you looked elsewhere — each a tap into the
          first such thread. Nothing at all when there is nothing to say. */}
      <ThreadInbox conversations={conversations} onOpen={onResume} />
      <div className="ui-loki-start-hello">
        <BrandMark showWordmark={false} />
        <h1 className="ui-loki-start-title">What are we working on?</h1>
      </div>

      {recent.length > 0 && (
        <nav aria-labelledby="loki-recent" className="ui-loki-start-section">
          <SectionHeading
            id="loki-recent"
            title="Recent"
            right={
              conversations.length > RESUME_LIMIT ? (
                <button type="button" className="ui-section-link" onClick={onBrowseAll}>
                  All chats
                </button>
              ) : undefined
            }
          />
          <List>
            {recent.map((convo) => {
              const project = convo.projectKeys[0];
              return (
                <ListRow
                  key={convo.id}
                  onClick={() => onResume(convo.id)}
                  avatar={
                    <RowInitial name={project ? projectTitle({ name: project }) : convo.title} />
                  }
                  title={convo.title}
                  secondary={project ? projectTitle({ name: project }) : undefined}
                  trailing={shortTimeAgo(Date.parse(convo.updatedAt))}
                />
              );
            })}
          </List>
        </nav>
      )}

      <BuildSuggestions onSend={onBuild} variant="rows" limit={2} />
    </div>
  );
}
