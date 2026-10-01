import type { ActivityEvent } from "@/lib/activity-events";

/**
 * Folding repeats on /activity, so a burst of the same thing reads as one fact.
 *
 * Live on 2026-10-01 the Needs-you card listed four failures with the same
 * sentence ("claude cannot generate because its usage limit is exhausted…")
 * one under another, and the feed carried 64 rows reading "Sent — No prompt
 * text was recorded for this dispatch." Each row was true; together they were
 * a wall that hid the one row that said something different.
 *
 * Pure, so the grouping is pinned without rendering (scripts/test/activity-grouping.ts).
 */

export type FailureGroup = {
  /** The shared reason, as the first event in the group words it. */
  cause: string;
  events: ActivityEvent[];
};

/**
 * Two failures share a cause when their reason reads the same once the parts
 * that differ per run are taken out: ids, numbers, quoted names. The first
 * event's wording is kept for display — the key is only for matching.
 */
export function causeKey(event: ActivityEvent): string {
  const raw = event.error?.trim() || `${event.outcomeLabel} with no recorded reason`;
  return raw
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, "<id>")
    .replace(/\d+/g, "#")
    .replace(/["“”'‘’`][^"“”'‘’`]{0,80}["“”'‘’`]/g, "<q>")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

/** Group failures by cause, largest group first, keeping first-seen order on ties. */
export function groupFailuresByCause(events: ActivityEvent[]): FailureGroup[] {
  const groups = new Map<string, FailureGroup>();
  for (const event of events) {
    const key = causeKey(event);
    const group = groups.get(key);
    if (group) group.events.push(event);
    else
      groups.set(key, {
        cause: event.error?.trim() || `${event.outcomeLabel} with no recorded reason`,
        events: [event],
      });
  }
  return [...groups.values()].sort((a, b) => b.events.length - a.events.length);
}

/**
 * A row that only says "this was sent": dispatched, no recorded prompt, nothing
 * came back yet. It carries no information beyond its project and its time, so
 * a run of them collapses into one line that names those.
 */
export function isBareDispatch(event: ActivityEvent): boolean {
  return (
    event.outcome === "dispatched" &&
    event.ask?.missing === true &&
    !event.done &&
    !event.error &&
    !event.next
  );
}

export type DayRows = {
  /** Rows that say something, in their original order. */
  rows: ActivityEvent[];
  /** Bare dispatches, folded. */
  bare: ActivityEvent[];
};

/** Only fold when there is a run worth folding — one bare row stays a row. */
export const BARE_FOLD_MIN = 3;

export function splitBareDispatches(events: ActivityEvent[]): DayRows {
  const bare = events.filter(isBareDispatch);
  if (bare.length < BARE_FOLD_MIN) return { rows: events, bare: [] };
  return { rows: events.filter((e) => !isBareDispatch(e)), bare };
}

/** "loki ×8 · Bitbaum ×4 · g" — projects in a folded run, most first. */
export function projectTally(events: ActivityEvent[]): string {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.projectKey, (counts.get(e.projectKey) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .join(" · ");
}
