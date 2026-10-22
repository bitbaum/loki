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
  const parts = [
    m.takenThisWeek === 0 ? "None chosen this week" : `${m.takenThisWeek} chosen this week`,
    `${m.takenAllTime} in total`,
  ];
  if (m.dayStreak > 1) parts.push(`${m.dayStreak} days in a row`);
  return `${parts.join(", ")}.`;
}

export function MomentumStrip({ momentum }: { momentum: Momentum }) {
  const sentence = momentumSentence(momentum);
  if (!sentence) return null;
  return <p className="ui-sugg-momentum">{sentence}</p>;
}
