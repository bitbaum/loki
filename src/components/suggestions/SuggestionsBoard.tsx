"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, RotateCcw, Sparkles } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { deleteJson, postJson } from "@/lib/api/fetch";
import { CardSkeleton } from "@/components/ui/card";
import { AVENUE_BY_ID, type AvenueId } from "@/config/suggestion-avenues";
import type { SuggestionBoard } from "@/lib/suggestions/board";
import {
  SUGGESTION_DECISION,
  type Suggestion,
  type SuggestionDecision,
} from "@/lib/suggestions/types";
import { MomentumStrip } from "./MomentumStrip";
import { SuggestionCard } from "./SuggestionCard";
import { suggestionHref } from "./suggestion-route";

type Filter = "all" | AvenueId;

type LastDismissed = { suggestion: Suggestion; decisionId: string | null };

/**
 * The board: momentum on top, one filter row, then every avenue's cards.
 *
 * Decisions are optimistic — a card leaves the moment it is answered, and
 * the server is told in the background. "Not now" leaves one undo line in
 * its place until the next decision, because a thumb on a phone misses.
 * "Do it" records the decision and then goes where the work is: Loki with
 * the ask written, or the page where only the person can do it.
 */
export function SuggestionsBoard() {
  const router = useRouter();
  const { data, loading, error, refetch } = useFetch<{ board: SuggestionBoard }>(
    "/api/suggestions",
    { timeoutMs: 15_000 },
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [lastDismissed, setLastDismissed] = useState<LastDismissed | null>(null);
  const [takenNow, setTakenNow] = useState(0);
  // Undone before the server answered: the decision that lands late is
  // deleted on arrival, so a fast thumb cannot leave a hidden row behind.
  const undone = useRef<Set<string>>(new Set());

  if (loading && !data) return <CardSkeleton />;
  if (error || !data) {
    return (
      <div className="ui-sugg-empty">
        <span className="ui-error">Could not load your suggestions.</span>
        <button type="button" className="ui-btn-secondary" onClick={refetch}>
          Try again
        </button>
      </div>
    );
  }

  const board = data.board;
  const avenues = board.avenues.map((a) => ({
    ...a,
    suggestions: a.suggestions.filter((s) => !gone.has(s.id)),
  }));
  const shown = filter === "all" ? avenues : avenues.filter((a) => a.id === filter);
  const total = avenues.reduce((n, a) => n + a.suggestions.length, 0);
  const momentum = {
    ...board.momentum,
    takenThisWeek: board.momentum.takenThisWeek + takenNow,
    takenAllTime: board.momentum.takenAllTime + takenNow,
    dayStreak: takenNow > 0 ? Math.max(board.momentum.dayStreak, 1) : board.momentum.dayStreak,
  };

  const decide = async (s: Suggestion, decision: SuggestionDecision) => {
    const res = await postJson("/api/suggestions/decisions", {
      suggestionId: s.id,
      decision,
      label: s.label,
    }).catch(() => null);
    if (!res?.ok) return null;
    const json = (await res.json().catch(() => null)) as { decision?: { id: string } } | null;
    return json?.decision?.id ?? null;
  };

  const take = (s: Suggestion) => {
    const href = suggestionHref(s);
    if (!href) return;
    setGone((g) => new Set(g).add(s.id));
    setTakenNow((n) => n + 1);
    setLastDismissed(null);
    void decide(s, SUGGESTION_DECISION.TAKEN);
    router.push(href);
  };

  const dismiss = (s: Suggestion) => {
    setGone((g) => new Set(g).add(s.id));
    setLastDismissed({ suggestion: s, decisionId: null });
    undone.current.delete(s.id);
    void decide(s, SUGGESTION_DECISION.DISMISSED).then((id) => {
      if (id && undone.current.has(s.id)) {
        void deleteJson(`/api/suggestions/decisions/${id}`);
        return;
      }
      setLastDismissed((cur) =>
        cur && cur.suggestion.id === s.id ? { suggestion: s, decisionId: id } : cur,
      );
    });
  };

  const undo = () => {
    if (!lastDismissed) return;
    const { suggestion, decisionId } = lastDismissed;
    setGone((g) => {
      const next = new Set(g);
      next.delete(suggestion.id);
      return next;
    });
    setLastDismissed(null);
    if (decisionId) void deleteJson(`/api/suggestions/decisions/${decisionId}`);
    else undone.current.add(suggestion.id);
  };

  return (
    <div className="ui-sugg-board">
      <MomentumStrip momentum={momentum} />

      <div className="ui-filter-chip-row ui-scroll-fade-right" role="tablist" aria-label="Avenues">
        <button
          type="button"
          role="tab"
          aria-selected={filter === "all"}
          className={filter === "all" ? "ui-chip-filter-active" : "ui-chip-filter"}
          onClick={() => setFilter("all")}
        >
          All {total}
        </button>
        {avenues.map((a) => {
          const meta = AVENUE_BY_ID[a.id];
          const active = filter === a.id;
          return (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={active ? "ui-chip-filter-active" : "ui-chip-filter"}
              onClick={() => setFilter(a.id)}
            >
              {meta.label}
              {a.locked ? (
                <Lock className="ml-1.5 inline h-3 w-3 align-[-1px]" aria-label="locked" />
              ) : (
                a.suggestions.length > 0 && ` ${a.suggestions.length}`
              )}
            </button>
          );
        })}
      </div>

      {lastDismissed && (
        <div className="ui-sugg-undo" role="status">
          <span className="min-w-0 truncate">
            Put away for a month: {lastDismissed.suggestion.label}
          </span>
          <button type="button" className="ui-btn-ghost" onClick={undo}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Undo
          </button>
        </div>
      )}

      {total === 0 && filter === "all" && !avenues.some((a) => a.locked) && (
        <div className="ui-sugg-empty">
          <Sparkles className="h-5 w-5 text-text-tertiary" aria-hidden />
          <p className="text-sm text-text-secondary">
            Nothing to suggest right now. Suggestions come from your own records — add a project, a
            goal, a habit or a person, and this page fills in.
          </p>
        </div>
      )}

      {shown.map((a) => {
        const meta = AVENUE_BY_ID[a.id];
        const Icon = meta.icon;
        // In the "All" view a quiet avenue is one line at the end, not a
        // heading over nothing; filtered, it is the page and says the way in.
        if (filter === "all" && a.suggestions.length === 0 && !a.locked) return null;
        return (
          <section key={a.id} className="ui-sugg-avenue" aria-label={meta.label}>
            <div className="ui-sugg-avenue-head">
              <div className="flex min-w-0 items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
                <h2 className="ui-sugg-avenue-title">{meta.label}</h2>
                <span className="ui-sugg-avenue-q">{meta.question}</span>
              </div>
              <Link href={meta.source.href} className="ui-sugg-avenue-source">
                {meta.source.label}
              </Link>
            </div>
            {a.locked ? (
              <Link
                href="/unlock?next=/suggestions"
                className="ui-locked-banner group gap-2 py-2.5"
              >
                <Lock className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
                  Behind your private-zone PIN.
                </span>
                <span className="ui-locked-banner-cta">Unlock</span>
              </Link>
            ) : a.suggestions.length === 0 ? (
              <p className="ui-sugg-quiet">
                Nothing from {meta.label.toLowerCase()} right now.{" "}
                <Link href={meta.source.href} className="ui-sugg-link">
                  {meta.source.label}
                </Link>
              </p>
            ) : (
              <ul className="ui-sugg-list">
                {a.suggestions.map((s) => (
                  <SuggestionCard key={s.id} suggestion={s} onTake={take} onDismiss={dismiss} />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {filter === "all" && total > 0 && (
        <QuietFronts
          avenues={avenues.filter((a) => a.suggestions.length === 0 && !a.locked).map((a) => a.id)}
        />
      )}
    </div>
  );
}

/** The avenues with nothing to say today, each with its way in — one line. */
function QuietFronts({ avenues }: { avenues: AvenueId[] }) {
  if (avenues.length === 0) return null;
  return (
    <p className="ui-sugg-quiet">
      Quiet today:{" "}
      {avenues.map((id, i) => {
        const meta = AVENUE_BY_ID[id];
        return (
          <span key={id}>
            {i > 0 && " · "}
            <Link href={meta.source.href} className="ui-sugg-link">
              {meta.label}
            </Link>
          </span>
        );
      })}
    </p>
  );
}
