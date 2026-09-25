/**
 * Post-reap honesty pass: a run the reaper just stamped `timeout` ("no
 * evidence of work") gets one more chance — if the project's GitHub repo
 * shows a PR opened or a branch pushed during the run window, the verdict is
 * corrected to `partial` with the evidence linked on the run. Born from the
 * 2026-07-28 recovery where two timed-out box runs had each shipped a real
 * fix (PRs #118/#120) that only existed on origin.
 *
 * Fire-and-forget from the reaper: GitHub lookups must never add latency to
 * the page-load reap call sites, and a correction that arrives a few seconds
 * after the reap is still a correction.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, userProjects } from "@/db/schema";
import { pendingCommands } from "@/db/schema/pending-commands";
import { ORCHESTRATION_OUTCOME, orchestrationRuns } from "@/db/schema/orchestration-runs";
import { ORCH_STATE } from "@/lib/orchestration/contract";
import { emitRunEvent } from "@/db/queries/run-events";
import { getGithubToken } from "@/lib/github-token";
import { findRepoWorkEvidence } from "@/lib/github-evidence";
import { ENTITY_TYPE } from "@/lib/constants/statuses";
import { EXECUTOR_COPY } from "@/config/executor-copy";

export type ReapedRunForEvidence = {
  id: string;
  userId: string;
  projectKey: string;
  outcome: string | null;
  startedAt: Date;
};

/** Bound GitHub API work per sweep — a backlog of dead runs must not turn the
 *  janitor into a rate-limit problem; the next hourly tick gets the rest. */
const MAX_CHECKS_PER_SWEEP = 5;

export async function correctTimeoutReapsWithRepoEvidence(
  reaped: ReapedRunForEvidence[],
): Promise<void> {
  const timeouts = reaped
    .filter((r) => r.outcome === ORCHESTRATION_OUTCOME.TIMEOUT)
    .slice(0, MAX_CHECKS_PER_SWEEP);

  for (const run of timeouts) {
    try {
      // Repo evidence is a TIME WINDOW, not an attribution. When several runs
      // for one project overlap, a single push satisfies all of their windows
      // — so this loop upgraded three runs to `partial` off one agent's work
      // (2026-08-24: 03626fa7 / d693460a / f917c891, one push between them).
      //
      // A run the runner itself acked `verified: false` never started, so no
      // commit in its window can be its work. Skipping it keeps the honest
      // `timeout` — which also matters because `partial` is not a failing
      // outcome, so an undeserved upgrade silently cancels the escalation
      // ladder for a run that did nothing.
      const [unverified] = await db
        .select({ id: pendingCommands.id })
        .from(pendingCommands)
        .where(
          and(
            eq(pendingCommands.userId, run.userId),
            sql`${pendingCommands.payload}->>'runId' = ${run.id}`,
            sql`${pendingCommands.result}->>'verified' = 'false'`,
          ),
        )
        .limit(1);
      if (unverified) continue;

      // The repo URL lives in TWO places (two-tier creation gap): the project
      // entity, and the user_projects registration whose name IS the run's
      // projectKey. Real fleets (loki itself) have it only on the
      // latter — check both.
      const project = await db.query.entities.findFirst({
        where: and(
          eq(entities.userId, run.userId),
          eq(entities.type, ENTITY_TYPE.PROJECT),
          sql`lower(${entities.name}) = lower(${run.projectKey})`,
        ),
        columns: { gitUrl: true },
      });
      const registration = project?.gitUrl
        ? null
        : await db.query.userProjects.findFirst({
            where: and(
              eq(userProjects.userId, run.userId),
              sql`lower(${userProjects.name}) = lower(${run.projectKey})`,
            ),
            columns: { gitUrl: true },
          });
      const gitUrl = project?.gitUrl ?? registration?.gitUrl;
      if (!gitUrl) continue;

      const token = await getGithubToken(run.userId);
      if (!token) continue;

      const evidence = await findRepoWorkEvidence(gitUrl, token, run.startedAt.getTime());
      if (!evidence) continue;

      const [corrected] = await db
        .update(orchestrationRuns)
        .set({
          state: ORCH_STATE.DONE,
          outcome: ORCHESTRATION_OUTCOME.PARTIAL,
          // `note`, not `error`: this run is being corrected UP to partial,
          // which is not a failure, and payload.error renders in the red
          // error style. Writing the explanation there made a corrected run
          // look worse than an uncorrected one.
          payload: sql`jsonb_set(
            jsonb_set(COALESCE(payload, '{}'), '{note}', to_jsonb(
              ${EXECUTOR_COPY.honesty.reapedButWorkInRepo}::text)),
            '{evidence}', ${JSON.stringify(evidence)}::jsonb)`,
        })
        // Only correct a run that is STILL a timeout — never overwrite a
        // verdict some other close path landed in the meantime.
        .where(
          and(
            eq(orchestrationRuns.id, run.id),
            eq(orchestrationRuns.outcome, ORCHESTRATION_OUTCOME.TIMEOUT),
          ),
        )
        .returning({ id: orchestrationRuns.id });

      if (corrected) {
        // A correction, not a second close: the reaper already emitted "closed".
        void emitRunEvent(run.id, run.userId, "reclassified", {
          outcome: ORCHESTRATION_OUTCOME.PARTIAL,
          by: "reaper-evidence",
          evidence,
        });
      }
    } catch (err) {
      console.error("[reap-evidence]", run.id, err instanceof Error ? err.message : err);
    }
  }
}
