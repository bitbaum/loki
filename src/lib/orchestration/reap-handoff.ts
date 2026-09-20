/**
 * Post-reap honesty pass #2: give a reaped `partial` run its handoff back.
 *
 * The reaper stamps `partial` on exactly one basis — `wroteAfterStart`, an
 * EXISTS over `project_states` proving the agent DID save a handoff inside the
 * run window. It then writes `payload.note` ("the agent had already saved a
 * handoff…") and stops. The handoff it just proved exists is never copied onto
 * the run, so `summary` stays NULL and the run records a verdict with nothing
 * behind it.
 *
 * `reapStaleRuns` already names that exact state as the thing to avoid — "the
 * run was reaped with a partial verdict and a NULL summary, recording a failure
 * whose reason nobody could read". Aligning the freshness floor removed one
 * CAUSE of it; the reaper still never filled the summary, so the state stayed
 * reachable by the ordinary path. Measured on prod 2026-09-20: 8 of the last 12
 * closed runs on `loki` were reaped partials with a completely empty summary —
 * every ~6 hours, for three days.
 *
 * That silence compounds, because the run summary is what briefs the NEXT run:
 * `done`/`next` are what the project dossier re-serves under "Recent run
 * outcomes". An empty summary means each dispatch is briefed with less than the
 * previous run actually knew.
 *
 * Deliberately narrow — this attaches EVIDENCE, it does not re-judge:
 *   - Only rows whose `summary` is still NULL. It never overwrites a summary
 *     some other close path landed, and re-running it is a no-op.
 *   - The run KEEPS its `partial` outcome. Re-deriving the verdict from the
 *     handoff would move escalation ladders and the failure brake, which read
 *     the outcome — a much larger change than "say what happened", and not one
 *     the reaper should make unattended.
 *   - The same freshness floor the reaper used (`runEffectiveStartMs`) is
 *     re-applied here, so a handoff written for a DIFFERENT, later run can
 *     never be pinned onto this one in the gap between the sweep and this pass.
 *
 * Fire-and-forget from the reaper, matching `correctTimeoutReapsWithRepoEvidence`
 * next to it: a page-load reap must not wait on this, and a summary that lands
 * a moment after the reap is still the summary.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectStates } from "@/db/schema/project-states";
import { ORCHESTRATION_OUTCOME, orchestrationRuns } from "@/db/schema/orchestration-runs";
import { summaryFromHandoff } from "./summary";
import { runEffectiveStartMs } from "./close-from-session";
import type { OrchestrationTaskSummary } from "./contract";

/** The reaped-run fields this pass needs. */
export type ReapedRunForHandoff = {
  id: string;
  userId: string;
  projectKey: string;
  outcome: string | null;
  summary: OrchestrationTaskSummary | null;
  startedAt: Date;
  /** Present on a reaped row (the sweep stamps it); `runEffectiveStartMs` needs the shape. */
  finishedAt: Date | null;
  payload?: { deliveredAt?: string } | null;
};

/**
 * Attach the saved handoff to every run this sweep reaped as `partial` with an
 * empty summary. Never throws — a failed backfill must not fail a reap.
 */
export async function attachHandoffToReapedPartials(reaped: ReapedRunForHandoff[]): Promise<void> {
  const candidates = reaped.filter(
    (r) => r.outcome === ORCHESTRATION_OUTCOME.PARTIAL && r.summary == null,
  );

  for (const run of candidates) {
    try {
      const [state] = await db
        .select({
          status: projectStates.sessionStatus,
          tsc: projectStates.sessionTsc,
          lint: projectStates.sessionLint,
          tests: projectStates.sessionTests,
          todos: projectStates.sessionTodos,
          done: projectStates.sessionDone,
          next: projectStates.sessionNext,
          commit: projectStates.sessionCommit,
          health: projectStates.sessionHealth,
          blockReason: projectStates.sessionBlockReason,
          noOpCount: projectStates.sessionNoOpCount,
          // The reaper's own recency basis: whichever of the two stamps is later.
          writtenAt: sql<Date>`GREATEST(${projectStates.readyAt}, ${projectStates.sessionUpdatedAt})`,
        })
        .from(projectStates)
        .where(
          and(
            eq(projectStates.userId, run.userId),
            sql`lower(${projectStates.projectKey}) = lower(${run.projectKey})`,
          ),
        )
        .limit(1);
      if (!state?.writtenAt) continue;

      const summary = summaryFromHandoff(
        { ...state, writtenAtMs: new Date(state.writtenAt).getTime() },
        runEffectiveStartMs(run),
      );
      if (!summary) continue;

      await db
        .update(orchestrationRuns)
        .set({ summary })
        // Still empty: never clobber a summary another close path wrote while
        // this pass was in flight.
        .where(and(eq(orchestrationRuns.id, run.id), isNull(orchestrationRuns.summary)));
    } catch (err) {
      console.error("[reap-handoff]", run.id, err instanceof Error ? err.message : err);
    }
  }
}
