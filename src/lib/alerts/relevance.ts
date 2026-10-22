/**
 * Which open alerts are still news — design reset rule 11
 * (docs/development/design-reset-2026-10.md): "A notification older than its
 * relevance resolves itself or folds into Earlier. Counts count only what
 * still needs the person."
 *
 * WHY THIS EXISTS. On 2026-10-21 the owner's bell read a red "9+" over a
 * partner application from 19 days ago, a builder nudge from 8 and a feedback
 * summary from 28. Each was still open, because:
 *
 *   - event alerts (a studio request, a build request, a fix that went live,
 *     an escalation) have no condition a checker can see end, so nothing ever
 *     cleared them — only a hand on "Dismiss";
 *   - insert-once producers (a stalled queue, escalations, capped goals)
 *     deduped against ANY open row, so one forgotten alert swallowed every
 *     later occurrence of the same kind (db/queries/alerts now lets a stale
 *     one go);
 *   - the bell counted every open row, however old.
 *
 * So age is part of the answer. An alert is CURRENT while it is younger than
 * its type's window (config/alert-types `freshForDays`), or while it is
 * urgent. Everything else is EARLIER: still listed, never counted.
 *
 * Pure — no DB, no clock of its own. Callers pass `now`.
 */
import { DAY_MS } from "@/lib/constants/time";
import { ALERT_SEVERITY } from "@/lib/constants/statuses";
import { alertFreshDays } from "@/config/alert-types";

export type RelevanceInput = {
  type: string;
  severity: string;
  createdAt: Date | string;
};

/** Still news: younger than its type's window, or urgent and still open. */
export function isAlertCurrent(alert: RelevanceInput, now: number): boolean {
  if (alert.severity === ALERT_SEVERITY.URGENT) return true;
  const at = new Date(alert.createdAt).getTime();
  if (!Number.isFinite(at)) return false;
  return now - at < alertFreshDays(alert.type) * DAY_MS;
}

/** Split into what needs the person now and what has folded into "Earlier". */
export function splitAlertsByRelevance<T extends RelevanceInput>(
  alerts: T[],
  now: number,
): { current: T[]; earlier: T[] } {
  const current: T[] = [];
  const earlier: T[] = [];
  for (const a of alerts) (isAlertCurrent(a, now) ? current : earlier).push(a);
  return { current, earlier };
}

/**
 * What the bell lists. New-feedback notices are work, listed under Home's "To
 * review" and on /feedback, not something that happened — the bell left them
 * out before this file existed, and still does.
 */
export function bellAlerts<T extends RelevanceInput>(
  alerts: T[],
  now: number,
): { current: T[]; earlier: T[] } {
  return splitAlertsByRelevance(
    alerts.filter((a) => a.type !== "new_feedback"),
    now,
  );
}

/** An alert as /api/alerts sends it: the server, which owns the clock, says
 *  whether it has folded into "Earlier". */
export type BellAlert = { type: string; earlier?: boolean };

/**
 * The bell's split on the client, from the server's `earlier` flag — a
 * component must not read the clock while it renders (react-hooks/purity),
 * and the server decided it with `isAlertCurrent` already.
 */
export function splitBell<T extends BellAlert>(alerts: T[]): { current: T[]; earlier: T[] } {
  const shown = alerts.filter((a) => a.type !== "new_feedback");
  return {
    current: shown.filter((a) => !a.earlier),
    earlier: shown.filter((a) => a.earlier),
  };
}
