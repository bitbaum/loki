import type { Momentum } from "@/lib/suggestions/board";

/**
 * What the person did with suggestions, as one sentence — design reset rule 7
 * ("stats are a sentence, not a row of pills"). It was three bordered boxes of
 * big numbers, and on a new account all three read 0: a scoreboard of
 * nothing over the page's actual content. Nothing chosen yet says nothing.
 *
 * Only records, never estimates: the page keeps score, it does not cheer.
 */
export function momentumSentence(m: Momentum): string | null {
  if (m.takenAllTime === 0) return null;
  // "None chosen this week, 2 in total" beside "Show: All (40)" read as two
  // totals that disagree (2026-11-12): say what the number counts.
  const taken = m.takenAllTime === 1 ? "1 suggestion" : `${m.takenAllTime} suggestions`;
  const parts = [`You've taken ${taken} so far`];
  if (m.takenThisWeek > 0) parts.push(`${m.takenThisWeek} this week`);
  if (m.dayStreak > 1) parts.push(`${m.dayStreak} days in a row`);
  return `${parts.join(", ")}.`;
}

export function MomentumStrip({ momentum }: { momentum: Momentum }) {
  const sentence = momentumSentence(momentum);
  if (!sentence) return null;
  return <p className="ui-sugg-momentum">{sentence}</p>;
}
