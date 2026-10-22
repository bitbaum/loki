"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bug,
  CalendarClock,
  Globe,
  Lightbulb,
  Play,
  RefreshCw,
  Sparkles,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { List, ListRow } from "@/components/ui/list-row";
import { SectionHeading } from "@/components/ui/section-heading";
import { NAV } from "@/config/navigation";
import type { BuildSuggestion, BuildSuggestionKind } from "@/lib/build-suggestions/rank";
import { trackUsage } from "@/lib/usage/track";

const SURFACE = "loki.build-next";

/** Exported so the full board (components/suggestions) draws the same icons. */
export const BUILD_KIND_ICON: Record<BuildSuggestionKind, LucideIcon> = {
  fix: Bug,
  ship: Globe,
  continue: Play,
  deadline: CalendarClock,
  goal: Target,
  idea: Lightbulb,
  demand: Users,
  starter: Sparkles,
};

/**
 * "Build next" — a few things this person could build, each one tap from an
 * agent doing it. Ranked server-side from their own records
 * (src/lib/build-suggestions); this only renders and routes the tap:
 *
 *   - project work → sent to Loki scoped to that project, which dispatches it
 *   - a new build → the prefilled create dialog, which ends in a kickoff
 *   - a goal or deadline → a Loki conversation told to end in action
 *
 * The refresh button rotates through everything that qualified rather than
 * re-rolling, so nothing real is skipped for good.
 *
 * `rows` (Loki's empty chat) is a short list of one-line rows above the
 * composer, the way ChatGPT offers a suggestion. It replaced a sideways
 * scrolling strip of chips whose scrollbar showed and whose second chip was
 * cut mid-word at the phone's edge (owner, 2026-10-21). `cards` shows each
 * suggestion's reason under its label: on Control, where nothing is running,
 * the reason is what makes an idea worth a tap.
 *
 * Every show, tap and rotate is recorded (src/config/usage-surfaces.ts), with
 * the variant and page it happened on, so Loki can later say which kinds of
 * suggestion this person takes and which it keeps offering for nothing — the
 * list improves from being used, not only from being built.
 */
export function BuildSuggestions({
  onSend,
  variant = "rows",
  title = "Build next",
  limit,
}: {
  onSend: (prompt: string, project: string | null) => void;
  variant?: "rows" | "cards";
  title?: string;
  /** Show at most this many; the rest are a rotate or "See all" away. */
  limit?: number;
}) {
  const [offset, setOffset] = useState(0);
  const { data } = useFetch<{ suggestions: BuildSuggestion[]; total: number }>(
    `/api/loki/suggestions?offset=${offset}`,
    { timeoutMs: 12_000 },
  );
  const suggestions = (data?.suggestions ?? []).slice(0, limit);
  // One "shown" per load, carrying what was offered — a tap only means
  // something next to what it was chosen from.
  useEffect(() => {
    const shown = (data?.suggestions ?? []).slice(0, limit);
    if (shown.length === 0) return;
    trackUsage({
      surface: SURFACE,
      action: "shown",
      meta: {
        offset,
        variant,
        kinds: shown.map((s) => s.kind),
        ids: shown.map((s) => s.id),
      },
    });
    // `offset` is already part of `data`: the fetch URL carries it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const tapped = (s: BuildSuggestion) =>
    trackUsage({ surface: SURFACE, action: "tap", target: s.id });
  // Nothing to suggest is not an error worth a box; the question above stands.
  // Nor is a heading over nothing while the list loads.
  if (suggestions.length === 0) return null;
  const canRotate = (data?.total ?? 0) > suggestions.length;
  const headingId = `build-next-${variant}`;

  const actions = (
    <span className="inline-flex items-center gap-1">
      {canRotate && (
        // The icon alone, named for screen readers: two worded links beside
        // the label wrapped onto three lines on a 390px phone (owner's
        // walk-through, 2026-10-17). Still the tracked "rotate".
        <button
          type="button"
          className="ui-loki-build-rotate"
          aria-label="Other ideas"
          title="Other ideas"
          onClick={() => {
            trackUsage({ surface: SURFACE, action: "rotate", meta: { offset: offset + 1 } });
            setOffset((o) => o + 1);
          }}
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
        </button>
      )}
      {/* The short list; the board is every front of life. */}
      <Link href={NAV.suggestions.href} className="ui-section-link">
        See all
      </Link>
    </span>
  );

  // Both variants are a section of rows (design reset, 2026-10). Home's
  // "cards" was a grid of bordered cards, the same shape as everything else
  // on that page; it keeps the reason under each idea, the chat's start
  // screen keeps only the idea.
  const withWhy = variant === "cards";
  return (
    <section aria-labelledby={headingId} className="ui-loki-start-section">
      <SectionHeading id={headingId} title={title} right={actions} />
      <List aria-label={title}>
        {suggestions.map((s) => (
          <ListRow
            key={s.id}
            icon={BUILD_KIND_ICON[s.kind]}
            title={s.label}
            secondary={withWhy ? s.why : undefined}
            chevron={withWhy}
            href={s.href ?? undefined}
            onClick={() => {
              tapped(s);
              if (!s.href && s.prompt) onSend(s.prompt, s.project);
            }}
          />
        ))}
      </List>
    </section>
  );
}
