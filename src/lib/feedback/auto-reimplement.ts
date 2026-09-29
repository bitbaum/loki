import { getFeedbackByRunId } from "@/db/queries/site-feedback";
import { mergeRunPayload, stampFeedbackAutoRetried } from "@/db/queries/orchestration-runs";
import { logDebug } from "@/db/queries/debug-logs";
import { implementFeedback } from "@/lib/feedback/implement";
import { decideAutoReimplement } from "@/lib/feedback/auto-reimplement-policy";
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
  runPayload: { priorRunId?: unknown; feedbackAutoRetriedAt?: unknown } | null | undefined,
): Promise<{ retried: boolean; reason?: string; newRunId?: string }> {
  try {
    // Off by default: a retry spends the operator's quota on a decision
    // nobody made (src/lib/auto-dispatch.ts). The row keeps Failed + Retry.
    if (!autoDispatchEnabled()) return { retried: false, reason: AUTO_DISPATCH_OFF_REASON };
    const decision = decideAutoReimplement(error, runPayload);
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
