import type { ProjectFeedbackSummary } from "@/db/queries/site-feedback";

/**
 * What "N feedback reports need you" means — in one place.
 *
 * ── The defect this closes ─────────────────────────────────────────────────
 * Measured on production 2026-09-22, on a SINGLE screen: the sidebar badged
 * Feedback **4** while, four inches to the right, /today's front-door verdict
 * said "**5** feedback reports to triage". Both were reducing the same
 * `/api/feedback/summary` payload. There were FOUR derivations of one number,
 * in three spellings:
 *
 *   use-control-inbox.ts   Σ (s.newCount || s.openCount)        → 5
 *   NotificationsPill.tsx  Σ (s.newCount || s.openCount)        → 5   (hand copy)
 *   ControlInbox.tsx       s.newCount > 0 ? s.newCount : s.openCount  (per chip)
 *   FeedbackNavCount.tsx   Σ s.newCount                         → 4
 *
 * ── Why the majority formula was the wrong one ─────────────────────────────
 * `newCount || openCount` is not merely a duplicate, it is BACKWARDS.
 * `openCount` is new + dispatched. So a project with 1 new and 4 dispatched
 * contributes 1, and a project with 0 new and 4 dispatched contributes 4: the
 * further along a project is, the MORE it inflates a number captioned "to
 * triage". Dispatched means an agent already has it. It is the opposite of
 * waiting on you.
 *
 * The fallback was added so a project chip would not vanish mid-watch when its
 * last NEW row flipped to dispatched. It never did that job —
 * `listFeedbackSummary` filters `status IN (NEW, DISPATCHED)`, so every row it
 * returns has `openCount > 0` and the chip stays listed on its own. The
 * fallback only ever leaked in-progress work into a count of pending judgement.
 *
 * So: **triage is the count, presence is the list, and they are different
 * questions.** Ask them by name.
 */

/** Reports awaiting YOUR judgement. The number behind every "needs you". */
export function feedbackAwaitingTriage(summary: ProjectFeedbackSummary[]): number {
  return summary.reduce((n, s) => n + s.newCount, 0);
}

/** Reports an agent already holds. Worth showing; never counted as needing you. */
export function feedbackInProgress(summary: ProjectFeedbackSummary[]): number {
  return summary.reduce((n, s) => n + Math.max(0, s.openCount - s.newCount), 0);
}

/**
 * The projects worth listing — anything with an open report, triaged or not,
 * so the chip you are watching a fix run on does not disappear underneath you.
 * Presence, not pressure.
 */
export function feedbackProjectsInPlay(
  summary: ProjectFeedbackSummary[],
): ProjectFeedbackSummary[] {
  return summary.filter((s) => s.openCount > 0);
}
