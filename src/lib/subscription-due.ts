import { addMonths, addWeeks, addYears, startOfDay } from "date-fns";
import { FREQUENCY } from "@/config/subscriptions";

/**
 * When a subscription is next charged, read honestly from a stored date.
 *
 * WHY THIS EXISTS
 * `next_due` is written once — when the row is added — and only moves when
 * someone presses "Mark paid". Recurring subscriptions charge the card on their
 * own, so nobody presses it, and the stored date drifts into the past. /money
 * printed every such row as "Overdue 14 May" in red: nine active subscriptions,
 * every one of them paid, every one of them flagged as a debt. A red word on
 * every row is not a warning, it is noise the eye learns to skip — which is how
 * a real problem would be missed.
 *
 * The rule:
 *   - a recurring subscription whose stored date has passed is RENEWING, not
 *     overdue: the next charge is the stored date rolled forward by whole
 *     periods until it is today or later;
 *   - a one-time charge in the past was CHARGED on that date;
 *   - a cancelled subscription has no next charge.
 * "Overdue" is not produced here at all: nothing this table stores can tell a
 * charge that failed from one that went through. When a failed-payment signal
 * exists, it gets its own state — guessing it from a date is what broke.
 */
export type DueState =
  { kind: "none" } | { kind: "due"; date: Date; rolled: boolean } | { kind: "charged"; date: Date };

const STEP: Record<string, (d: Date, n: number) => Date> = {
  [FREQUENCY.MONTHLY]: addMonths,
  [FREQUENCY.QUARTERLY]: (d, n) => addMonths(d, n * 3),
  [FREQUENCY.ANNUAL]: addYears,
  [FREQUENCY.WEEKLY]: addWeeks,
};

export function subscriptionDue(
  nextDue: Date | string | null | undefined,
  frequency: string | null | undefined,
  options: { cancelled?: boolean; now?: Date } = {},
): DueState {
  if (!nextDue || options.cancelled) return { kind: "none" };
  const stored = new Date(nextDue);
  if (Number.isNaN(stored.getTime())) return { kind: "none" };
  const today = startOfDay(options.now ?? new Date());
  if (stored >= today) return { kind: "due", date: stored, rolled: false };

  // An unknown frequency is treated as monthly, matching advanceDueDate in
  // lib/dates.ts (the "Mark paid" path) so the two never disagree.
  const step = frequency === FREQUENCY.ONE_TIME ? null : (STEP[frequency ?? ""] ?? addMonths);
  if (!step) return { kind: "charged", date: stored };

  // Step from the stored date (not from "now") so the day of the month the card
  // is billed on survives — and count from the anchor each time, so a 31st
  // does not slide to the 28th forever after one February.
  for (let n = 1; n <= 10_000; n++) {
    const next = step(stored, n);
    if (next >= today) return { kind: "due", date: next, rolled: true };
  }
  return { kind: "none" };
}

/** The date a list should sort or summarise by, or null when there is none. */
export function nextChargeDate(state: DueState): Date | null {
  return state.kind === "due" ? state.date : null;
}

/**
 * Rows whose next charge (rolled forward, as above) falls on or before `by`,
 * soonest first, each carrying that charge date. A SQL `next_due <= by` filter
 * matched every stale stored date too — Today's "6 more imminent bills" was
 * mostly subscriptions that had already renewed months ago.
 */
export function chargesDueBy<T extends { nextDue: Date | string | null; frequency: string | null }>(
  rows: T[],
  by: Date,
  now: Date = new Date(),
): (T & { nextCharge: Date })[] {
  return rows
    .map((row) => ({
      row,
      date: nextChargeDate(subscriptionDue(row.nextDue, row.frequency, { now })),
    }))
    .filter((x): x is { row: T; date: Date } => x.date !== null && x.date <= by)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map(({ row, date }) => ({ ...row, nextCharge: date }));
}
