/**
 * Close the silent run a message is waiting behind (lib/orchestration/
 * quiet-lane holds the rule and why). This file only gathers the facts and
 * applies the answer.
 *
 * Called at claim time, before the claim gate reads the lane, so the message
 * that was waiting is claimable in the same request that closed the run.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import { ORCHESTRATION_OUTCOME, orchestrationRuns } from "@/db/schema/orchestration-runs";
import { notifyRunClosed } from "@/lib/orchestration/notify-close";
import { correctTimeoutReapsWithRepoEvidence } from "@/lib/orchestration/reap-evidence";
import { attachHandoffToReapedPartials } from "@/lib/orchestration/reap-handoff";
import {
  quietLaneReason,
  quietLaneStep,
  type QuietLaneFacts,
} from "@/lib/orchestration/quiet-lane";
import { handoffAfterRunStartSql, olderOpenRunSql } from "./orchestration-runs";
import { emitRunEvent } from "./run-events";

type HeadRow = {
  id: string;
  user_id: string;
  delivered_at: string | null;
  last_progress_at: string | null;
  blocked: string | null;
  quiet_seen_at: string | null;
  outstanding: boolean;
};

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/**
 * For every message waiting in a project's shared session, the run at the
 * head of that lane. One row per head, however many messages wait behind it.
 * The lane is read through olderOpenRunSql, the claim gate's own predicate,
 * so this can only ever look at a run the gate is really waiting for.
 */
async function waitedOnHeads(userIds: string[]): Promise<HeadRow[]> {
  const rows = await db.execute<HeadRow>(sql`
    SELECT DISTINCT ON (b.id)
           b.id, b.user_id,
           b.payload->>'deliveredAt' AS delivered_at,
           b.payload->>'lastProgressAt' AS last_progress_at,
           b.payload->>'blocked' AS blocked,
           b.payload->>'quietSeenAt' AS quiet_seen_at,
           EXISTS (
             SELECT 1 FROM pending_commands o
              WHERE o.user_id = b.user_id
                AND o.payload->>'runId' = b.id::text
                AND o.executed_at IS NULL
           ) AS outstanding
      FROM pending_commands pc
      JOIN orchestration_runs own
        ON own.id = CASE WHEN pc.payload->>'runId' ~ '^[0-9a-f-]{36}$'
                         THEN (pc.payload->>'runId')::uuid END
      JOIN LATERAL (
        ${olderOpenRunSql(
          sql`(own.started_at, own.id)`,
          sql`own.user_id`,
          sql`own.project_key`,
          sql`r.id`,
        )}
        ORDER BY r.started_at, r.id
        LIMIT 1
      ) head ON TRUE
      JOIN orchestration_runs b ON b.id = head.id
     WHERE pc.user_id IN (${sql.join(
       userIds.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})
       AND pc.type IN ('dispatch','inject')
       AND pc.claimed_at IS NULL
       AND pc.executed_at IS NULL
       AND own.finished_at IS NULL
       AND own.payload->>'sessionTab' IS NULL
     ORDER BY b.id
     LIMIT 20`);
  return [...rows];
}

/** Only while the run is open and has not beaten since the facts were read:
 *  a beat that lands between the read and the write keeps the run. */
function unchangedSince(row: HeadRow) {
  return and(
    eq(orchestrationRuns.id, row.id),
    eq(orchestrationRuns.userId, row.user_id),
    isNull(orchestrationRuns.finishedAt),
    sql`COALESCE(${orchestrationRuns.payload}->>'lastProgressAt', '') = ${row.last_progress_at ?? ""}`,
  );
}

/**
 * Returns the ids of the runs closed. The verdict is the reaper's own, only
 * sooner and with the true reason: `partial` with the handoff note when the
 * project pushed a handoff during the run, otherwise `timeout` with the
 * sentence in payload.error, which reap-evidence upgrades to `partial` when
 * the agent had pushed a branch or opened a pull request.
 *
 * Does not advance the project's escalation ladder: an agent that answered
 * and stopped without a handoff is not evidence the project is failing, and
 * the reaper stays the judge of runs nobody is waiting behind.
 */
export async function releaseQuietLanes(
  userIds: string[],
  nowMs: number = Date.now(),
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const heads = await waitedOnHeads(userIds);
  const released: string[] = [];
  for (const row of heads) {
    const facts: QuietLaneFacts = {
      deliveredAtMs: ms(row.delivered_at),
      lastProgressAtMs: ms(row.last_progress_at),
      blocked: row.blocked,
      hasOutstandingCommand: row.outstanding,
      quietSeenAtMs: ms(row.quiet_seen_at),
    };
    const step = quietLaneStep(facts, nowMs);
    if (step.kind === "hold") continue;
    if (step.kind === "mark") {
      await db
        .update(orchestrationRuns)
        .set({
          payload: sql`jsonb_set(COALESCE(payload, '{}'), '{quietSeenAt}', to_jsonb(${new Date(nowMs).toISOString()}::text))`,
        })
        .where(unchangedSince(row));
      continue;
    }
    const wroteAfterStart = handoffAfterRunStartSql();
    const reason = quietLaneReason(step.quietSinceMs, nowMs);
    const quietSinceIso = new Date(step.quietSinceMs).toISOString();
    const [closed] = await db
      .update(orchestrationRuns)
      .set({
        state: sql`CASE WHEN ${wroteAfterStart} THEN 'done' ELSE 'error' END`,
        outcome: sql`CASE WHEN ${wroteAfterStart} THEN 'partial' ELSE 'timeout' END`,
        // The work ended when the agent went quiet, not when this noticed.
        finishedAt: sql`GREATEST(${orchestrationRuns.startedAt}, LEAST(NOW(), ${quietSinceIso}::timestamptz))`,
        payload: sql`CASE
          WHEN ${wroteAfterStart}
            THEN jsonb_set(COALESCE(payload, '{}'), '{note}', to_jsonb(${EXECUTOR_COPY.honesty.reapedButHandoffWritten}::text))
          ELSE jsonb_set(COALESCE(payload, '{}'), '{error}', to_jsonb(${reason}::text))
        END`,
      })
      .where(unchangedSince(row))
      .returning();
    if (!closed) continue;
    released.push(closed.id);
    void emitRunEvent(closed.id, closed.userId, "closed", {
      outcome: closed.outcome ?? ORCHESTRATION_OUTCOME.TIMEOUT,
      by: "quiet-lane",
      quietSince: quietSinceIso,
    });
    void notifyRunClosed(closed);
    if (closed.outcome === ORCHESTRATION_OUTCOME.TIMEOUT) {
      void correctTimeoutReapsWithRepoEvidence([closed]);
    }
    if (closed.outcome === ORCHESTRATION_OUTCOME.PARTIAL && closed.summary == null) {
      void attachHandoffToReapedPartials([closed]);
    }
  }
  return released;
}
