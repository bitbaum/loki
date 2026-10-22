"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, RotateCcw, Sparkles } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { deleteJson, postJson } from "@/lib/api/fetch";
import { CardSkeleton } from "@/components/ui/card";
import { ChoiceMenu } from "@/components/ui/choice-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { List, ListRow } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
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
 * The board: one line of what was chosen and a "Show: All ▾" menu, then each
 * avenue as a section of rows (design reset, 2026-10). It opened on three
 * bordered boxes of big numbers — all 0 on a new account — over a chip row
 * cut off mid-word at the phone's edge.
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
      <EmptyState
        icon={Sparkles}
        title="Your suggestions did not load."
        action={
          <button type="button" className="ui-btn-secondary" onClick={refetch}>
            Try again
          </button>
        }
      />
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

  const filterOptions = [
    { value: "all" as Filter, label: total > 0 ? `All (${total})` : "All" },
    ...avenues.map((a) => ({
      value: a.id as Filter,
      label: a.locked
        ? `${AVENUE_BY_ID[a.id].label} (locked)`
        : a.suggestions.length > 0
          ? `${AVENUE_BY_ID[a.id].label} (${a.suggestions.length})`
          : AVENUE_BY_ID[a.id].label,
    })),
  ];
  const nothingAtAll = total === 0 && !avenues.some((a) => a.locked);

  return (
    <div className="ui-sugg-board">
      {!nothingAtAll && (
        <div className="ui-sugg-top">
          <MomentumStrip momentum={momentum} />
          <ChoiceMenu label="Show" value={filter} options={filterOptions} onChange={setFilter} />
        </div>
      )}

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

      {nothingAtAll && filter === "all" && (
        <EmptyState
          icon={Sparkles}
          title="Nothing to suggest yet"
          action={
            <Link href="/projects?new=1" className="ui-btn-secondary">
              Add a project
            </Link>
          }
        />
      )}

      {shown.map((a) => {
        const meta = AVENUE_BY_ID[a.id];
        // In the "All" view a quiet avenue is one line at the end, not a
        // heading over nothing; filtered, it is the page and says the way in.
        if (filter === "all" && a.suggestions.length === 0 && !a.locked) return null;
        return (
          <Section
            key={a.id}
            title={meta.label}
            link={a.locked ? undefined : { href: meta.source.href, label: meta.source.label }}
          >
            {a.locked ? (
              <List aria-label={`${meta.label}, locked`}>
                <ListRow
                  href="/unlock?next=/suggestions"
                  icon={Lock}
                  title="Unlock to see these"
                  secondary="They are behind your private-zone PIN."
                  chevron
                />
              </List>
            ) : a.suggestions.length === 0 ? (
              <EmptyState>Nothing from {meta.label.toLowerCase()} right now.</EmptyState>
            ) : (
              <List aria-label={meta.label}>
                {a.suggestions.map((s) => (
                  <SuggestionCard key={s.id} suggestion={s} onTake={take} onDismiss={dismiss} />
                ))}
              </List>
            )}
          </Section>
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
