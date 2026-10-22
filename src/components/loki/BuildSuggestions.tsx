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
import { NAV } from "@/config/navigation";
import { List, ListRow } from "@/components/ui/list-row";
import { SectionHeading } from "@/components/ui/section-heading";
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
 * "Build next" — a row of things this person could build, each one tap from
 * an agent doing it. Ranked server-side from their own records
 * (src/lib/build-suggestions); this only renders and routes the tap:
 *
 *   - project work → sent to Loki scoped to that project, which dispatches it
 *   - a new build → the prefilled create dialog, which ends in a kickoff
 *   - a goal or deadline → a Loki conversation told to end in action
 *
 * The refresh button rotates through everything that qualified rather than
 * re-rolling, so nothing real is skipped for good.
 *
 * `cards` shows each suggestion's reason under its label. A chip carries it
 * only as a `title` — a tooltip, which a phone never shows — and on Control,
 * where nothing is running, the reason is what makes an idea worth a tap.
 *
 * Every show, tap and rotate is recorded (src/config/usage-surfaces.ts), with
 * the variant and page it happened on, so Loki can later say which kinds of
 * suggestion this person takes and which it keeps offering for nothing — the
 * row improves from being used, not only from being built.
 */
export function BuildSuggestions({
  onSend,
  variant = "chips",
  title = "Build next",
}: {
  onSend: (prompt: string, project: string | null) => void;
  variant?: "chips" | "cards";
  title?: string;
}) {
  const [offset, setOffset] = useState(0);
  const { data, loading } = useFetch<{ suggestions: BuildSuggestion[]; total: number }>(
    `/api/loki/suggestions?offset=${offset}`,
    { timeoutMs: 12_000 },
  );
  const suggestions = data?.suggestions ?? [];
  // One "shown" per load, carrying what was offered — a tap only means
  // something next to what it was chosen from.
  useEffect(() => {
    if (!data || data.suggestions.length === 0) return;
    trackUsage({
      surface: SURFACE,
      action: "shown",
      meta: {
        offset,
        variant,
        kinds: data.suggestions.map((s) => s.kind),
        ids: data.suggestions.map((s) => s.id),
      },
    });
    // `offset` is already part of `data`: the fetch URL carries it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const tapped = (s: BuildSuggestion) =>
    trackUsage({ surface: SURFACE, action: "tap", target: s.id });
  // Nothing to suggest is not an error worth a box; the question above stands.
  if (!loading && suggestions.length === 0) return null;
  const canRotate = (data?.total ?? 0) > suggestions.length;
  // Home's variant: a section of rows (design reset, 2026-10) — it was a grid
  // of bordered cards, the same shape as everything else on the page.
  if (variant === "cards") {
    return (
      <section aria-label={title}>
        <SectionHeading title={title} link={{ href: NAV.suggestions.href, label: "See all" }} />
        <List aria-label={title}>
          {suggestions.map((s) => (
            <ListRow
              key={s.id}
              icon={BUILD_KIND_ICON[s.kind]}
              title={s.label}
              secondary={s.why}
              href={s.href ?? undefined}
              onClick={
                s.href
                  ? undefined
                  : () => {
                      tapped(s);
                      if (s.prompt) onSend(s.prompt, s.project);
                    }
              }
              chevron
            />
          ))}
        </List>
      </section>
    );
  }

  return (
    <section aria-label="Build next" className="ui-loki-build">
      <div className="ui-loki-start-recent-head">
        <span className="ui-micro-label">{title}</span>
        <span className="inline-flex items-center gap-3">
          {canRotate && (
            // The icon alone, named for screen readers: two worded links beside
            // the label wrapped onto three lines on a 390px phone (owner's
            // walk-through, 2026-10-17). Still the tracked "rotate".
            <button
              type="button"
              className="ui-loki-start-more inline-flex min-h-11 min-w-11 items-center justify-center"
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
          {/* The row is the short list; the board is every front of life. */}
          <Link
            href={NAV.suggestions.href}
            className="ui-loki-start-more inline-flex min-h-11 items-center"
          >
            See all
          </Link>
        </span>
      </div>
      <ul className="ui-loki-build-row" aria-busy={loading}>
        {suggestions.map((s) => {
          const Icon = BUILD_KIND_ICON[s.kind];
          const body = (
            <>
              <Icon className="ui-loki-build-icon" aria-hidden />
              <span className="ui-loki-build-label">{s.label}</span>
            </>
          );
          const cls = "ui-loki-build-chip";
          return (
            <li key={s.id} className="shrink-0">
              {s.href ? (
                <Link href={s.href} className={cls} title={s.why} onClick={() => tapped(s)}>
                  {body}
                </Link>
              ) : (
                <button
                  type="button"
                  className={cls}
                  title={s.why}
                  onClick={() => {
                    tapped(s);
                    if (s.prompt) onSend(s.prompt, s.project);
                  }}
                >
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
