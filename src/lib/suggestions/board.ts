/**
 * The /suggestions board — every avenue's suggestions, minus what the person
 * already decided on, with the numbers that say how it is going.
 *
 * Pure: load.ts gathers; this merges and decides. The rules it holds:
 *
 *   - A decision hides a suggestion for a window (types.ts), not forever —
 *     the fact behind it is re-read on every load, so what is still true
 *     comes back when the window closes.
 *   - Within an avenue, score order. Across the board, the same: a delivered
 *     crew task sits above a note to reconnect, whatever avenue it is in.
 *   - "Momentum" is counted from decisions the person actually made — taken
 *     this week, taken in all, and the run of days with at least one — and
 *     from nothing else. A number here is a record, never an estimate.
 */
import { KIND_AVENUE, SUGGESTION_AVENUES, type AvenueId } from "@/config/suggestion-avenues";
import { DAY_MS } from "@/lib/constants/time";
import { toLocalDateStr } from "@/lib/dates";
import {
  DISMISSED_HIDE_DAYS,
  SUGGESTION_DECISION,
  TAKEN_HIDE_DAYS,
  type Suggestion,
  type SuggestionDecisionRecord,
} from "./types";

export type AvenueBoard = {
  id: AvenueId;
  suggestions: Suggestion[];
  /** Listed but not read: the private zone is locked. */
  locked: boolean;
};

export type Momentum = {
  takenThisWeek: number;
  takenAllTime: number;
  /** Consecutive days, ending today or yesterday, with at least one "Do it". */
  dayStreak: number;
};

export type SuggestionBoard = {
  avenues: AvenueBoard[];
  momentum: Momentum;
  total: number;
};

const WEEK_MS = 7 * DAY_MS;

export function hiddenIds(decisions: SuggestionDecisionRecord[], now: Date): Set<string> {
  const hidden = new Set<string>();
  for (const d of decisions) {
    const age = now.getTime() - new Date(d.createdAt).getTime();
    const window = d.decision === SUGGESTION_DECISION.TAKEN ? TAKEN_HIDE_DAYS : DISMISSED_HIDE_DAYS;
    if (age < window * DAY_MS) hidden.add(d.suggestionId);
  }
  return hidden;
}

export function momentumFrom(decisions: SuggestionDecisionRecord[], now: Date): Momentum {
  const taken = decisions.filter((d) => d.decision === SUGGESTION_DECISION.TAKEN);
  const takenThisWeek = taken.filter(
    (d) => now.getTime() - new Date(d.createdAt).getTime() < WEEK_MS,
  ).length;
  const days = new Set(taken.map((d) => toLocalDateStr(new Date(d.createdAt))));
  // The streak may start yesterday: a day is not lost until it is over.
  let cursor = new Date(now);
  if (!days.has(toLocalDateStr(cursor))) cursor = new Date(cursor.getTime() - DAY_MS);
  let dayStreak = 0;
  while (days.has(toLocalDateStr(cursor))) {
    dayStreak++;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }
  return { takenThisWeek, takenAllTime: taken.length, dayStreak };
}

export function buildBoard(input: {
  suggestions: Suggestion[];
  decisions: SuggestionDecisionRecord[];
  /** Avenues the loader could not read because the private zone is locked. */
  lockedAvenues: AvenueId[];
  now?: Date;
}): SuggestionBoard {
  const now = input.now ?? new Date();
  const hidden = hiddenIds(input.decisions, now);
  const seen = new Set<string>();
  const visible = input.suggestions
    .filter((s) => {
      if (hidden.has(s.id) || seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const locked = new Set(input.lockedAvenues);
  const avenues: AvenueBoard[] = SUGGESTION_AVENUES.map((a) => ({
    id: a.id,
    suggestions: visible.filter((s) => KIND_AVENUE[s.kind] === a.id),
    locked: locked.has(a.id),
  }));

  return {
    avenues,
    momentum: momentumFrom(input.decisions, now),
    total: visible.length,
  };
}
