"use client";

import { useState } from "react";
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
 * `cards` shows each suggestion's reason under its label. A chip carries it
 * only as a `title` — a tooltip, which a phone never shows — and on Control,
 * where nothing is running, the reason is what makes an idea worth a tap.
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
  // Nothing to suggest is not an error worth a box; the question above stands.
  if (!loading && suggestions.length === 0) return null;
  const canRotate = (data?.total ?? 0) > suggestions.length;
  const cards = variant === "cards";

  return (
    <section aria-label="Build next" className="ui-loki-build">
      <div className="ui-loki-start-recent-head">
        <span className="ui-micro-label">{title}</span>
        {canRotate && (
          <button
            type="button"
            className="ui-loki-start-more inline-flex items-center gap-1"
            onClick={() => setOffset((o) => o + 1)}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Other ideas
          </button>
        )}
      </div>
      <ul className={cards ? "ui-loki-build-cards" : "ui-loki-build-row"} aria-busy={loading}>
        {suggestions.map((s) => {
          const Icon = KIND_ICON[s.kind];
          const body = cards ? (
            <>
              <Icon className="ui-loki-build-icon mt-0.5" aria-hidden />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="ui-loki-build-card-label">{s.label}</span>
                <span className="ui-loki-build-card-why">{s.why}</span>
              </span>
            </>
          ) : (
            <>
              <Icon className="ui-loki-build-icon" aria-hidden />
              <span className="ui-loki-build-label">{s.label}</span>
            </>
          );
          const cls = cards ? "ui-loki-build-card" : "ui-loki-build-chip";
          return (
            <li key={s.id} className={cards ? "min-w-0" : "shrink-0"}>
              {s.href ? (
                <Link href={s.href} className={cls} title={s.why}>
                  {body}
                </Link>
              ) : (
                <button
                  type="button"
                  className={cls}
                  title={s.why}
                  onClick={() => s.prompt && onSend(s.prompt, s.project)}
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
