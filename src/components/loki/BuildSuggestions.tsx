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
import type { BuildSuggestion, BuildSuggestionKind } from "@/lib/build-suggestions/rank";
import { trackUsage } from "@/lib/usage/track";

const SURFACE = "loki.build-next";

const KIND_ICON: Record<BuildSuggestionKind, LucideIcon> = {
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
 * Every show, tap and rotate is recorded (src/config/usage-surfaces.ts), so
 * Loki can later say which kinds of suggestion this person takes and which it
 * keeps offering for nothing — the row improves from being used, not only
 * from being built.
 */
export function BuildSuggestions({
  onSend,
}: {
  onSend: (prompt: string, project: string | null) => void;
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

  return (
    <section aria-label="Build next" className="ui-loki-build">
      <div className="ui-loki-start-recent-head">
        <span className="ui-micro-label">Build next</span>
        {canRotate && (
          <button
            type="button"
            className="ui-loki-start-more inline-flex items-center gap-1"
            onClick={() => {
              trackUsage({ surface: SURFACE, action: "rotate", meta: { offset: offset + 1 } });
              setOffset((o) => o + 1);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Other ideas
          </button>
        )}
      </div>
      <ul className="ui-loki-build-row" aria-busy={loading}>
        {suggestions.map((s) => {
          const Icon = KIND_ICON[s.kind];
          const body = (
            <>
              <Icon className="ui-loki-build-icon" aria-hidden />
              <span className="ui-loki-build-label">{s.label}</span>
            </>
          );
          return (
            <li key={s.id} className="shrink-0">
              {s.href ? (
                <Link
                  href={s.href}
                  className="ui-loki-build-chip"
                  title={s.why}
                  onClick={() => tapped(s)}
                >
                  {body}
                </Link>
              ) : (
                <button
                  type="button"
                  className="ui-loki-build-chip"
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
