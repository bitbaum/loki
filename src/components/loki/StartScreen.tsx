"use client";

import { NAV } from "@/config/navigation";
import { useLocalNow } from "@/hooks/use-local-now";
import { APP_LOCALE } from "@/lib/constants/locale";
import { shortTimeAgo } from "@/lib/dates";
import { deriveThreadState } from "@/lib/loki/thread-state";
import { BrandMark } from "@/components/shell/BrandMark";
import { List, ListRow } from "@/components/ui/list-row";
import { SectionHeading } from "@/components/ui/section-heading";
import { BuildSuggestions } from "./BuildSuggestions";
import { StartNow } from "./StartNow";
import { ThreadInbox } from "./ThreadInbox";
import { rowProject, stateInputOf } from "./ThreadRail";
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
/**
 * The row into the day, named for the reader's hour. /loki became the home
 * after sign-in (2026-11-01), and the day — what needs you, habits,
 * commitments — stayed on Today (2026-10-21), so the page a person lands on
 * every morning said nothing about the morning (owner, 2026-11-12: "it could
 * tell what time it is and say what's today and let's start my day"). One
 * row, not the card that was removed: the day itself stays Today's.
 */
export function dayRowTitle(hour: number): string {
  if (hour >= 5 && hour < 12) return "Start my day";
  if (hour >= 12 && hour < 17) return "My day";
  return "Wrap up my day";
}

/** "Thursday 12 November · 07:20", in the app's locale. */
export function startDateLine(now: Date): string {
  const day = now.toLocaleDateString(APP_LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const time = now.toLocaleTimeString(APP_LOCALE, { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

export function StartScreen({
  conversations,
  loading,
  error,
  onRetry,
  onResume,
  onBrowseAll,
  onBuild,
  railPinned,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
  /** The chat list did not load: said here, not only inside the drawer, or
   *  an empty Recent reads as "you have no chats". */
  error?: string | null;
  onRetry?: () => void;
  onResume: (id: string) => void;
  onBrowseAll: () => void;
  /** A "Build next" suggestion was tapped: send it, scoped to its project. */
  onBuild: (prompt: string, project: string | null) => void;
  /** The rail is pinned. From 768px up it is on screen, listing these very
   *  threads, so "Recent" is hidden there. */
  railPinned: boolean;
}) {
  // When the rail is open it owns resuming — the same threads twice side by
  // side is noise. The list is still rendered and hidden with CSS from the
  // rail's breakpoint up: deciding it in JS needed the viewport, which the
  // server does not know, so every desktop load drew "Recent" and then took
  // it away (the start screen went 501px to 238px tall under the eye).
  const recent = conversations.slice(0, RESUME_LIMIT);
  // The reader's clock, after mount: the server's is UTC (hooks/use-local-now).
  const now = useLocalNow();

  // Nothing is rendered while the list is still unknown, so the greeting does
  // not jump when the rows arrive.
  if (loading && conversations.length === 0) return null;

  return (
    <div className="ui-loki-start">
      {/* One line of truth above the greeting: what needs you, what runs,
          what came back while you looked elsewhere — each a tap into the
          first such thread. Nothing at all when there is nothing to say. */}
      <StartNow />
      <ThreadInbox conversations={conversations} onOpen={onResume} />
      <div className="ui-loki-start-hello">
        <BrandMark showWordmark={false} />
        <h1 className="ui-loki-start-title">What are we working on?</h1>
        {/* A non-breaking space holds the line until the clock is known. */}
        <p className="ui-loki-start-date">{now ? startDateLine(now) : "\u00a0"}</p>
      </div>

      {error && conversations.length === 0 && (
        <div className="ui-loki-start-section gap-2" role="alert">
          <p className="ui-loki-convo-meta mb-0">Couldn&rsquo;t load your chats.</p>
          {onRetry && (
            <button type="button" className="ui-btn-chip self-start" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      )}

      <nav aria-label="Your day" className="ui-loki-start-section">
        <List>
          <ListRow
            href={NAV.today.href}
            icon={NAV.today.icon}
            title={now ? dayRowTitle(now.getHours()) : NAV.today.label}
            secondary="What needs you today"
            chevron
          />
        </List>
      </nav>

      {recent.length > 0 && (
        <nav
          aria-labelledby="loki-recent"
          className={railPinned ? "ui-loki-start-section md:hidden" : "ui-loki-start-section"}
        >
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
            {/* The rail's row, minus its menu: the same chat drawn the same
                way one tap apart (owner audit, 2026-11-12). */}
            {recent.map((convo) => {
              const line = [
                deriveThreadState(stateInputOf(convo)).label || null,
                rowProject(convo.title, convo.projectKeys[0]),
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <ListRow
                  key={convo.id}
                  onClick={() => onResume(convo.id)}
                  title={convo.title}
                  secondary={line || undefined}
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
