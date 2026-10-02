import { FEEDBACK_WORK_PHASE } from "@/lib/feedback/work-phase";

/**
 * Folding the /feedback inbox so a wall of the same thing reads as one fact.
 *
 * Live 2026-10-01: "Needs you" held 36 rows and 28 of them ended in the same
 * sentence — "The agent opened but never answered — Retry runs it on the next
 * provider." The page was 17,000px on a phone, and the rows that needed a
 * different decision sat between copies of that one. Shipped rendered all of
 * its rows too, under a section nobody acts on.
 *
 * Pure, so the grouping is pinned without rendering (scripts/test/feedback-inbox-groups.ts).
 */

type Groupable = {
  id: string;
  work: { phase: string; detail?: string | null };
};

/** A cause has to repeat at least this often before it earns a fold. */
export const SAME_FAILURE_MIN = 3;

/** How many shipped reports show before "Show all". */
export const SHIPPED_SHOWN = 5;

export type FailureFold<T> = { cause: string; items: T[] };

function isFailed(item: Groupable): boolean {
  return (
    item.work.phase === FEEDBACK_WORK_PHASE.FAILED || item.work.phase === FEEDBACK_WORK_PHASE.STUCK
  );
}

/**
 * Split "Needs you" into rows that stay rows and failures folded by their
 * shared reason. Order is preserved within each part; the largest fold first.
 */
export function foldSameFailures<T extends Groupable>(
  items: T[],
): { rows: T[]; folds: FailureFold<T>[] } {
  const byCause = new Map<string, T[]>();
  for (const item of items) {
    const cause = item.work.detail?.trim();
    if (!isFailed(item) || !cause) continue;
    byCause.set(cause, [...(byCause.get(cause) ?? []), item]);
  }
  const folds = [...byCause.entries()]
    .filter(([, group]) => group.length >= SAME_FAILURE_MIN)
    .map(([cause, group]) => ({ cause, items: group }))
    .sort((a, b) => b.items.length - a.items.length);
  const folded = new Set(folds.flatMap((f) => f.items.map((i) => i.id)));
  return { rows: items.filter((i) => !folded.has(i.id)), folds };
}
