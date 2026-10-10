/**
 * "Back in 30 minutes."
 *
 * The owner says how long they will be gone — in the chat, in words — and
 * the next screen they open leads with what happened while they were out:
 * what finished, what went live, what arrived, what is still running, and
 * what now needs them. One card, every number a link to where it is acted
 * on, dismissed with one tap. Stated 2026-10-10: "if I say I'm coming back
 * in half an hour and I open the screen and it is not immediately clear
 * what has been done and what needs to be done, then it is not a good
 * product."
 *
 * The absence is two timestamps on user_preferences (awaySince, awayUntil).
 * The summary is derived at read time from the runs and the feedback that
 * moved since awaySince — nothing is recorded during the absence, so there
 * is nothing that can be missed. The pure parts are tested.
 */
import { listRecentRuns } from "@/db/queries/orchestration-runs";
import { listUserFeedback } from "@/db/queries/site-feedback";
import { getUserPreferences, upsertUserPreferences } from "@/db/queries/user-preferences";
import { attachFeedbackWork } from "@/lib/feedback/attach-work";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { WAITING_ON, FEEDBACK_WORK_PHASE } from "@/lib/feedback/work-phase";
import { ORCH_STATE, ORCHESTRATION_OUTCOME } from "@/lib/orchestration/contract";
import { awayStatus, AWAY_MAX_MINUTES, type AwaySummary } from "@/lib/away-rules";

export * from "@/lib/away-rules";

/** What happened since `since` — derived, never recorded. */
export async function whileYouWereAway(
  userId: string,
  since: string,
  until: string,
  now = Date.now(),
): Promise<AwaySummary> {
  const sinceMs = Date.parse(since);
  const [runs, feedback] = await Promise.all([
    listRecentRuns(userId, { limit: 50, sinceMs: Math.max(1, now - sinceMs) }),
    listUserFeedback(userId, 200),
  ]);
  const finished = runs.filter((r) => r.finishedAt && r.finishedAt.getTime() >= sinceMs);
  const running = runs.filter(
    (r) => r.state === ORCH_STATE.RUNNING || r.state === ORCH_STATE.WAITING,
  );
  const ok = finished.filter(
    (r) =>
      r.outcome === ORCHESTRATION_OUTCOME.SUCCESS || r.outcome === ORCHESTRATION_OUTCOME.PARTIAL,
  ).length;

  const open = feedback.filter((f) => f.status !== FEEDBACK_STATUS.ARCHIVED);
  const withWork = await attachFeedbackWork(userId, open).catch(() => []);
  const needsYou = withWork.filter(
    (f) => f.status !== FEEDBACK_STATUS.RESOLVED && f.work.waitingOn === WAITING_ON.YOU,
  ).length;
  // A fix that went live since: its row waits for a look and its run closed
  // in the window. The ledger's own timestamp is not stored, so the run's end
  // stands in for it.
  const finishedIds = new Set(finished.map((r) => r.id));
  const live = withWork.filter(
    (f) =>
      f.work.phase === FEEDBACK_WORK_PHASE.NEEDS_VERIFY &&
      f.work.checkLive === true &&
      f.dispatchedRunId &&
      finishedIds.has(f.dispatchedRunId),
  ).length;
  const arrived = feedback.filter((f) => new Date(f.createdAt).getTime() >= sinceMs).length;

  return {
    since,
    until,
    minutes: Math.max(0, Math.round((now - sinceMs) / 60_000)),
    runs: {
      started: runs.length,
      finished: finished.length,
      ok,
      failed: finished.length - ok,
      running: running.length,
    },
    projects: [...new Set(finished.map((r) => r.projectKey))],
    reports: { arrived, live },
    needsYou,
  };
}

export async function setAway(userId: string, minutes: number, now = Date.now()) {
  const m = Math.max(1, Math.min(AWAY_MAX_MINUTES, Math.round(minutes)));
  const since = new Date(now).toISOString();
  const until = new Date(now + m * 60_000).toISOString();
  await upsertUserPreferences(userId, { awaySince: since, awayUntil: until });
  return { since, until, minutes: m };
}

export async function clearAway(userId: string) {
  await upsertUserPreferences(userId, { awaySince: null, awayUntil: null });
}

export async function readAway(userId: string, now = Date.now()) {
  const prefs = await getUserPreferences(userId);
  return awayStatus(prefs, now);
}
