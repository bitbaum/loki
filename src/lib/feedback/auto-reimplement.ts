import { getFeedbackByRunId } from "@/db/queries/site-feedback";
import { mergeRunPayload, stampFeedbackAutoRetried } from "@/db/queries/orchestration-runs";
import { logDebug } from "@/db/queries/debug-logs";
import { implementFeedback } from "@/lib/feedback/implement";
import { decideAutoReimplement, providersTriedAfter } from "@/lib/feedback/auto-reimplement-policy";
import { providerLabel } from "@/config/quota-alternatives";
import { AUTO_DISPATCH_OFF_REASON, autoDispatchEnabled } from "@/lib/auto-dispatch";

export { decideAutoReimplement, autoRetryNotice } from "@/lib/feedback/auto-reimplement-policy";
export type { AutoReimplementDecision } from "@/lib/feedback/auto-reimplement-policy";

/**
 * The second attempt a person would have made, made for them.
 *
 * A feedback run that the runner refuses at its LAST step — the CLI answered
 * the prompt with a usage-limit wall, or opened and never started generating —
 * used to sit on the row as "Failed" until someone came back to Loki and
 * pressed Retry. The owner who left the note from their phone on a Sunday
 * morning (2026-09-28, Petvity: refused 66 seconds after dispatch) never saw
 * the row; the fix that was one click away was never made.
 *
 * Retry at dispatch time already knows how to route around a spent provider
 * (`implementFeedback` → `routeAroundSpent`), so the missing piece is only the
 * click. This makes it once, for the two failure classes a second attempt can
 * plausibly answer, and never for the ones that need a person: dead
 * credentials, a workspace that does not exist on the builder. Loop safety is
 * a stamp on the failed run and a `priorRunId` on the new one: a run that is
 * itself a retry is never retried again.
 */

/**
 * Called from the runner's failing ack, after the run is closed as
 * undelivered. Finds the feedback item the run belonged to (if any), decides,
 * and re-implements through the same path as the Retry button. Never throws:
 * an ack must succeed whatever this does.
 */
export async function autoReimplementAfterRunnerNack(
  userId: string,
  runId: string,
  error: string | null | undefined,
  runPayload:
    | { priorRunId?: unknown; feedbackAutoRetriedAt?: unknown; providersTried?: unknown }
    | null
    | undefined,
  runAdapter?: string | null,
): Promise<{ retried: boolean; reason?: string; newRunId?: string }> {
  try {
    const decision = decideAutoReimplement(error, runPayload);
    // Quota failover is NOT gated by LOKI_AUTO_DISPATCH. It continues the
    // person's own tap on the same item — the operator asked for it
    // (2026-10-21: "out of Claude and ChatGPT tokens", keep going on the
    // others) — and it never re-spends the agent that ran out. Every other
    // automatic retry is still off by default (src/lib/auto-dispatch.ts).
    if (decision.retry && decision.failover) {
      const feedback = await getFeedbackByRunId(userId, runId);
      if (!feedback) return { retried: false, reason: "not-feedback" };
      return await failoverOnQuota(
        userId,
        runId,
        feedback.id,
        runPayload,
        runAdapter,
        decision.because,
      );
    }
    if (!autoDispatchEnabled()) return { retried: false, reason: AUTO_DISPATCH_OFF_REASON };
    if (!decision.retry) return { retried: false, reason: decision.reason };
    const feedback = await getFeedbackByRunId(userId, runId);
    if (!feedback) return { retried: false, reason: "not-feedback" };

    // Stamp first: a crash between here and the new run can never loop.
    await stampFeedbackAutoRetried(runId, userId);
    const result = await implementFeedback(userId, feedback.id);
    const newRunId = typeof result.body.runId === "string" ? result.body.runId : undefined;
    if (!newRunId) {
      void logDebug({
        source: "feedback-auto-reimplement",
        level: "warn",
        message: `Auto-retry of feedback ${feedback.id} was not accepted (${result.status})`,
        meta: { userId, runId, error, body: result.body },
      });
      return { retried: false, reason: `not-accepted:${result.status}` };
    }
    await mergeRunPayload(newRunId, {
      priorRunId: runId,
      autoRetriedBecause: decision.because,
    }).catch(() => undefined);
    void logDebug({
      source: "feedback-auto-reimplement",
      level: "info",
      message: `Feedback ${feedback.id} retried automatically: ${decision.because}`,
      meta: { userId, runId, newRunId, error },
    });
    return { retried: true, newRunId };
  } catch (e) {
    void logDebug({
      source: "feedback-auto-reimplement",
      level: "error",
      message: e instanceof Error ? e.message : String(e),
      meta: { userId, runId, error },
    }).catch(() => undefined);
    return { retried: false, reason: "threw" };
  }
}

/**
 * One hop of the quota failover chain: record what this run tried, start the
 * same item on the next provider that has not run out, and carry the list
 * forward. When none is left, the failed run keeps the full list so its row
 * reads "tried Claude Code, Codex — sign another in", not "Done — try again".
 */
async function failoverOnQuota(
  userId: string,
  runId: string,
  feedbackId: string,
  runPayload: { providersTried?: unknown } | null | undefined,
  runAdapter: string | null | undefined,
  because: string,
): Promise<{ retried: boolean; reason?: string; newRunId?: string }> {
  const tried = providersTriedAfter(runPayload, runAdapter);
  await stampFeedbackAutoRetried(runId, userId);
  await mergeRunPayload(runId, { providersTried: tried }).catch(() => undefined);
  const result = await implementFeedback(userId, feedbackId, { exclude: tried });
  const newRunId = typeof result.body.runId === "string" ? result.body.runId : undefined;
  if (!newRunId) {
    void logDebug({
      source: "feedback-auto-reimplement",
      level: "warn",
      message: `Quota failover for feedback ${feedbackId} stopped: ${String(result.body.error ?? result.status)}`,
      meta: { userId, runId, tried, body: result.body },
    });
    return {
      retried: false,
      reason: result.body.exhausted ? "failover-exhausted" : `not-accepted:${result.status}`,
    };
  }
  const last = tried[tried.length - 1];
  await mergeRunPayload(newRunId, {
    priorRunId: runId,
    providersTried: tried,
    autoRetriedBecause: last ? `${providerLabel(last)} ran out of quota` : because,
  }).catch(() => undefined);
  void logDebug({
    source: "feedback-auto-reimplement",
    level: "info",
    message: `Feedback ${feedbackId} failed over after quota: tried ${tried.join(", ")}`,
    meta: { userId, runId, newRunId, tried },
  });
  return { retried: true, newRunId };
}
