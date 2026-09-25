/**
 * Shared run-close with the definition-of-done stop-gate.
 *
 * Extracted from /api/control (which closes runs when a page poll sees a fresh
 * session handoff) so the reap-stale-runs cron can close runs UNATTENDED from
 * runner-pushed session state. Before this, run-close only ever happened on a
 * human page load — box-executed autopilot runs finished their work at 04:00,
 * nobody looked, and the reaper stamped them `timeout` an hour later (the
 * 2026-07-14 diagnosis: 14 days of autopilot, zero recorded successes, all of
 * them real work reaped as failures).
 */
import { getProjectGoalConfig } from "@/db/queries/project-context";
import { updateOrchestrationRun } from "@/db/queries/orchestration-runs";
import { emitRunEvent } from "@/db/queries/run-events";
import { applyDoDGate } from "@/lib/orchestration/dod-gate";
import { precheckEvidence, EVIDENCE_PRECHECK_ID } from "@/lib/orchestration/evidence-precheck";
import type { RunClosePatch } from "@/lib/orchestration/close-from-session";
import type { OrchestrationOutcome } from "@/db/schema/orchestration-runs";
import { ORCHESTRATION_OUTCOME } from "@/db/schema/orchestration-runs";
import { insertActiveAlertOnce } from "@/db/queries/alerts";
import { selfTelegramTarget, sendTelegramMessage } from "@/lib/actions/telegram-send";
import { logDebug } from "@/db/queries/debug-logs";

/**
 * Tell a human that a goal loop stopped at its cap without meeting its bar.
 * Same shape as the escalation ladder's human rung — one alert while it stays
 * open, plus a push — because "autopilot gave up on this goal" is exactly as
 * actionable as "autopilot failed N times", and neither the failure brake nor
 * the ladder can see it (a partial streak is not a failure streak).
 */
async function reportCappedGoal(input: {
  userId: string;
  projectKey: string;
  attempts: number;
  gap: string;
}): Promise<void> {
  try {
    const created = await insertActiveAlertOnce({
      userId: input.userId,
      type: "goal_capped",
      severity: "warning",
      title: `${input.projectKey}: goal stopped after ${input.attempts} attempts`,
      description: `The definition of done was not met and autopilot stopped re-looping. Still missing: ${input.gap}`,
    });
    if (!created) return; // already open — don't re-notify every close
    const target = selfTelegramTarget();
    if (target) {
      await sendTelegramMessage(
        target,
        `⏸ ${input.projectKey}: goal stopped after ${input.attempts} attempts.\nStill missing: ${input.gap}`,
      ).catch(() => {});
    }
  } catch (e) {
    void logDebug({
      source: "orchestration/gate-and-close",
      level: "warn",
      message: `Failed to report capped goal for ${input.projectKey}: ${(e as Error).message}`,
    });
  }
}

/** Runs whose close is being gated/persisted right now — prevents the DoD judge
 *  from firing more than once per run while a fire-and-forget close is in flight.
 *  Module-level so the control route and the cron sweep share one in-flight set. */
export const closingRuns = new Set<string>();

/**
 * Close an orchestration run, applying the definition-of-done stop-gate first.
 * When the run would close SUCCESS and the project declares a definition_of_done,
 * a deterministic evidence precheck tests the handoff against that bar; if it isn't met,
 * the run closes "partial" with the gap as `next`, so autopilot's continue-loop
 * keeps working instead of stopping on the agent's own say-so (the /goal pattern).
 */
export async function gateAndCloseRun(
  runId: string,
  closePatch: RunClosePatch,
  userId: string,
  projectKey: string,
  recentOutcomes: OrchestrationOutcome[] = [],
  workerAdapter = "agent",
): Promise<void> {
  let patch = closePatch;
  if (closePatch.outcome === ORCHESTRATION_OUTCOME.SUCCESS) {
    const { definitionOfDone: dod, maxTurns } = await getProjectGoalConfig(
      userId,
      projectKey,
    ).catch(() => ({ definitionOfDone: null, maxTurns: null }));
    if (dod) {
      // Deterministic first: when the bar demands a check whose handoff field is
      // simply blank, a string test reaches the same `met: false` the judge's own
      // "Missing evidence = not done" rule would — without spending a model call,
      // and with a groupable gapCode instead of another one-off sentence. Prod
      // 2026-08-07: this is 64.6% of all rejections. Falls through to the judge
      // whenever it cannot decide, so nothing is ever approved by a rule.
      //
      // And ONLY deterministic, since 2026-09-25. The model judge that used to
      // decide the rest ran on every close — a page poll, a runner push, the
      // hourly sweep — so nobody ever asked for one of its calls, and it spent
      // the box's free tier that every app shares. When the precheck cannot
      // decide, the run closes on its own outcome: exactly what the judge's
      // fail-open path already did whenever it was unavailable.
      const precheck = precheckEvidence(dod, closePatch.summary);
      if (precheck) {
        const verdict = { met: false, gap: precheck.gap };
        // priorPartials = consecutive partial closes so far = how many times the
        // goal has already re-looped (recentOutcomes is most-recent-first).
        let priorPartials = 0;
        for (const o of recentOutcomes) {
          if (o === ORCHESTRATION_OUTCOME.PARTIAL) priorPartials++;
          else break;
        }
        patch = applyDoDGate(closePatch, verdict, { maxTurns, priorPartials });
        // The cap stopped the loop → say so out loud. applyDoDGate deliberately
        // keeps the SUCCESS outcome so the continue-loop halts, which means the
        // ledger alone would show a success and nobody would learn the goal was
        // abandoned short of its bar. A cap that only writes itself into `next`
        // is a silent cap.
        if (!verdict.met && maxTurns != null && priorPartials >= maxTurns) {
          void reportCappedGoal({
            userId,
            projectKey,
            attempts: maxTurns,
            gap: verdict.gap || "the stated bar is not evidenced in the handoff",
          });
        }
        // Record the verdict on the run so Activity can show that something other
        // than the worker checked its handoff, and what it found.
        patch = {
          ...patch,
          summary: {
            ...patch.summary,
            verification: {
              judge: EVIDENCE_PRECHECK_ID,
              worker: workerAdapter,
              met: verdict.met,
              gap: verdict.gap || undefined,
              gapCode: precheck.gapCode,
            },
          },
        };
      }
    }
  }
  await updateOrchestrationRun(runId, patch, userId);
  // Run ledger: the closing hop declares itself with its (possibly DoD-gated)
  // outcome — the run's biography ends with a verdict, not silence.
  void emitRunEvent(runId, userId, "closed", { outcome: patch.outcome, state: patch.state });
}
