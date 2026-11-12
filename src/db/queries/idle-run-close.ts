/**
 * An idle run is closed before the task behind it starts.
 *
 * An idle run no longer holds its project (runIdleSql in olderOpenRunSql), so
 * the claim gate lets the next task into the same session. The idle run was
 * left OPEN until the hourly reaper, and a project's `ready` handoff closes
 * every delivered open run of that project (lib/orchestration/close-sweep,
 * closeOpenRunsForProject). So when the next task reported, both runs closed
 * with its summary: a run whose agent had gone quiet was recorded as done, off
 * another run's work. That is the 2026-08-24 fault this queue's comments
 * describe, reached from the other side.
 *
 * At claim time, when a task waits in a project that has an idle open run,
 * the reaper's own close runs for that account first. One verdict, one
 * sentence, the reaper's; only the moment is new.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { cleanupStaleOrchestrationRuns, runIdleSql } from "./orchestration-runs";

/** Accounts with an idle open run in a project where a task is waiting. */
async function accountsWithIdleRunAhead(userIds: string[]): Promise<string[]> {
  const rows = await db.execute<{ user_id: string }>(sql`
    SELECT DISTINCT r.user_id
      FROM orchestration_runs r
     WHERE r.user_id IN (${sql.join(
       userIds.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})
       AND r.finished_at IS NULL
       AND r.payload->>'sessionTab' IS NULL
       AND ${runIdleSql("r")}
       AND EXISTS (
         SELECT 1 FROM pending_commands pc
          WHERE pc.user_id = r.user_id
            AND pc.type IN ('dispatch','inject')
            AND pc.claimed_at IS NULL
            AND pc.executed_at IS NULL
            AND pc.payload->>'projectKey' = r.project_key
            AND pc.payload->>'runId' IS DISTINCT FROM r.id::text
       )`);
  return [...rows].map((row) => row.user_id);
}

/** Returns how many runs were closed. Never throws past its caller's catch. */
export async function closeIdleRunsAhead(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const accounts = await accountsWithIdleRunAhead(userIds);
  let closed = 0;
  for (const userId of accounts) {
    closed += (await cleanupStaleOrchestrationRuns(userId)).length;
  }
  return closed;
}
