import type { FixShipping } from "@/lib/feedback/fix-shipping";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "@/db";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import { ORCH_STATE, type OrchestrationState } from "@/lib/orchestration/contract";
import {
  ORCHESTRATION_OUTCOME,
  orchestrationRuns,
  type NewOrchestrationRun,
  type OrchestrationOutcome,
} from "@/db/schema/orchestration-runs";
import type { OrchestrationTaskIntentId } from "@/lib/orchestration";
import { promoteRunClose } from "@/lib/integrations/orangecat-publish";
import { advanceEscalation, resolveEscalation } from "./run-escalations";
import { ladderEffectForClose } from "@/lib/orchestration/escalation-ladder";
import { notifyRunClosed } from "@/lib/orchestration/notify-close";
import { deliveryStampFor } from "@/lib/orchestration/close-from-session";
import { correctTimeoutReapsWithRepoEvidence } from "@/lib/orchestration/reap-evidence";
import { attachHandoffToReapedPartials } from "@/lib/orchestration/reap-handoff";
import { emitRunEvent } from "./run-events";
import { RUNNER_OFFLINE_THRESHOLD_MS } from "@/lib/constants/runner";
import { runLaneOfTab } from "@/lib/run-tab";

export const STALE_RUN_MINUTES = 60;

/**
 * Absolute ceiling on how long a run may stay open, even with a live agent
 * heartbeat. Real autopilot turns do run for hours (datacat worked 04:00→11:00
 * on 2026-08-02), so the ceiling has to clear that comfortably; past it, a
 * "still running" claim is far more likely a wedged process than progress.
 */
export const MAX_RUN_HOURS = 12;

/** The table names a lane/clock fragment may be rendered against. A closed
 *  union, not a string: the alias goes into SQL raw, so it must never be
 *  anything a caller computed. */
type RunAlias = "r" | "own" | "orchestration_runs";

/**
 * When a run's working life began: the moment its prompt reached an agent.
 *
 * `started_at` is when the ROW was created, which for a queued dispatch can be
 * most of an hour before any agent sees it. Every timer that measured a run's
 * life from there charged it for time it spent waiting in line — and three
 * different timers did, each written separately: the reaper's staleness
 * window, the reaper's absolute ceiling, and the lane floor in the claim gate.
 *
 * Measured on 2026-09-17: a feedback fix queued at 16:01 behind a Next Best
 * Task, was delivered at 16:48, streamed output until 17:08, went quiet for a
 * moment and was reaped at 17:15 — 47 of its 60 minutes spent waiting its
 * turn. The same pair also showed the lane floor releasing on a timer: the
 * run ahead crossed `started_at + 60 min` at 16:48:37 while still open, and
 * two seconds later the next prompt was "injected to running claude (pty)" —
 * typed into the session it was supposed to wait for.
 *
 * So there is one clock, rendered here, and every timer reads it. The closer
 * already used this floor (runEffectiveStartMs); now the reaper and the gate
 * do too. An undelivered run falls back to `started_at`, so a run no builder
 * ever claims is still bounded.
 */
export function runLifeStartSql(alias: RunAlias) {
  const t = sql.raw(alias);
  return sql`COALESCE((${t}.payload->>'deliveredAt')::timestamptz, ${t}.started_at)`;
}

/**
 * An open run keeps holding its project's lane until the reaper's own
 * absolute ceiling — never less.
 *
 * The gate used to release a lane at STALE_RUN_MINUTES, written to "mirror"
 * the reaper so a crashed run could not wedge a project. The mirror broke when
 * the reaper learned to shelter a live agent for up to MAX_RUN_HOURS: from
 * then on, any agent turn longer than an hour let the next dispatch into the
 * same tab. The reaper is what decides a run is dead; the gate waits for its
 * verdict (finished_at), and only past the point where the reaper would
 * certainly have reaped it does the gate stop waiting.
 */
export function laneLifeFloorSql(alias: RunAlias) {
  return sql`${runLifeStartSql(alias)} > NOW() - make_interval(hours => ${MAX_RUN_HOURS})`;
}

/**
 * The runs that hold a project's lane ahead of a given run, as ONE definition.
 *
 * Composed by the claim gate (fifoEligibilitySql), by findQueueBlockers (what
 * the UI tells a person), and by the reaper (a run waiting its turn is not
 * stale), so the decision the queue makes, the sentence a person reads, and
 * the reaper's verdict cannot drift apart. The caller passes its own run's
 * identity as SQL, because the gate reads it out of a command payload while
 * the reaper and the lookup read it off the run row.
 */
export function olderOpenRunSql(ownTuple: SQL, userId: SQL, projectKey: SQL) {
  return sql`
      SELECT 1 FROM orchestration_runs r
      WHERE r.user_id = ${userId}
        AND r.project_key = ${projectKey}
        AND r.finished_at IS NULL
        AND ${laneLifeFloorSql("r")}
        AND r.payload->>'sessionTab' IS NULL
        -- Orphan open runs must not block the queue: a run with NO pending
        -- command row at all was never enqueued (or its command was deleted) —
        -- that was the "Install queued → empty Terminal" wedge. But a run
        -- whose command was EXECUTED is an agent session that owns the tab:
        -- it must keep blocking until the run CLOSES (finished_at). Releasing
        -- on ack (executed_at), or on a timer shorter than the reaper's, is
        -- the documented merged-sessions regression: dispatch B's prompt typed
        -- into A's still-working PTY.
        AND EXISTS (
          SELECT 1 FROM pending_commands pc
          WHERE pc.user_id = r.user_id
            AND pc.payload->>'runId' = r.id::text
        )
        AND (r.started_at, r.id) < ${ownTuple}`;
}

export async function createOrchestrationRun(run: NewOrchestrationRun) {
  const [created] = await db.insert(orchestrationRuns).values(run).returning();
  return created;
}

// userId is optional: API callers should pass it for isolation;
// background worker callers can omit it since runId is already unique.
export async function updateOrchestrationRun(
  id: string,
  patch: Partial<NewOrchestrationRun>,
  userId?: string,
) {
  const condition = userId
    ? and(eq(orchestrationRuns.id, id), eq(orchestrationRuns.userId, userId))
    : eq(orchestrationRuns.id, id);

  const [updated] = await db.update(orchestrationRuns).set(patch).where(condition).returning();

  // SUCCESS used to auto-resolve linked feedback here. That claimed the live
  // product shipped when only the agent run closed — inject delivered ≠ Done.
  // Feedback stays dispatched → "Check live" until operator Resolve (or a
  // future live-stamp / merged-PR closer calls resolveFeedbackForRun).
  //
  // Run→wall loop still fires: successful agent work surfaces as OrangeCat
  // activity for OC-published projects. Idempotent (external_id = run id) and
  // re-sent by the daily promote backfill, so a dropped emit here is never lost.
  if (updated && patch.finishedAt && patch.outcome === ORCHESTRATION_OUTCOME.SUCCESS) {
    void promoteRunClose(updated);
  }

  // Escalation ladder. ONE predicate decides both directions
  // (ladderEffectForClose): a failing close advances a rung, and any close
  // where work landed — `success` OR `partial` — resolves it.
  //
  // Resolving used to require `success` while advancing used isFailingOutcome,
  // so `partial` did neither and a ladder could never be left. Seventeen were
  // stuck open at once, none with a single success since opening. The brake
  // never had the bug (leadingFailureStreak stops at the first non-failing
  // outcome), so this also makes the two agree, which the comment here always
  // claimed they did.
  //
  // Fire-and-forget — bookkeeping never fails a close.
  if (updated && patch.finishedAt) {
    const effect = ladderEffectForClose(patch.outcome);
    if (effect.kind === "advance") {
      void advanceEscalation({
        userId: updated.userId,
        projectKey: updated.projectKey,
        runId: updated.id,
        outcome: patch.outcome ?? "error",
        error: updated.payload?.error ?? null,
      });
    } else if (effect.kind === "resolve") {
      void resolveEscalation(updated.userId, updated.projectKey, effect.by);
    }
  }

  // Chat-originated runs push their outcome back to chat (opt-in via
  // payload.notifyOnClose). Both branches above are outcome-specific; this
  // fires on ANY close so a chat dispatch never ends in silence.
  if (updated && patch.finishedAt) {
    void notifyRunClosed(updated);
  }

  return updated;
}

/**
 * Delivery stamp: the runner ack'd this run's prompt as actually typed into the
 * session. Recorded on payload (NEVER on startedAt — (started_at, id) is the
 * serialization order in the claim gate and isProjectBusy; re-stamping it would
 * flip blocking direction mid-flight). The close paths use deliveredAt as the
 * handoff-freshness floor, so a stale ready re-push from before delivery can
 * never close this run.
 */
export async function stampRunDelivered(
  runId: string,
  userId: string,
  /** The runner's own injection time, when it reports one (see deliveryStampFor). */
  reportedDeliveredAt?: unknown,
): Promise<void> {
  let stamp = new Date().toISOString();
  if (typeof reportedDeliveredAt === "string") {
    const run = await getOrchestrationRunById(userId, runId).catch(() => null);
    stamp = deliveryStampFor(reportedDeliveredAt, run?.startedAt ?? null);
  }
  await db
    .update(orchestrationRuns)
    .set({
      payload: sql`jsonb_set(COALESCE(payload, '{}'), '{deliveredAt}', ${JSON.stringify(stamp)}::jsonb)`,
    })
    .where(
      and(
        eq(orchestrationRuns.id, runId),
        eq(orchestrationRuns.userId, userId),
        isNull(orchestrationRuns.finishedAt),
      ),
    );
}

/**
 * The runner nack'd the dispatch — the prompt never landed, so the run can
 * never produce a handoff. Close it as error IMMEDIATELY: leaving it open would
 * head-of-line block the project's queued dispatches for up to
 * STALE_RUN_MINUTES. Outcome ≠ success, so close-the-loop never fires off it.
 */

/**
 * Runner inject ack verdict on the open run — Feedback's one alive bit reads
 * payload.injectVerified (true = generating confirmed; false = inject-no-generate).
 */
export async function stampRunInjectAck(
  runId: string,
  userId: string,
  verified: boolean,
  warning: string | null = null,
): Promise<void> {
  await db
    .update(orchestrationRuns)
    .set({
      payload: sql`jsonb_set(
        jsonb_set(COALESCE(payload, '{}'), '{injectVerified}', ${JSON.stringify(verified)}::jsonb),
        '{injectWarning}', ${JSON.stringify(warning)}::jsonb)`,
    })
    .where(
      and(
        eq(orchestrationRuns.id, runId),
        eq(orchestrationRuns.userId, userId),
        isNull(orchestrationRuns.finishedAt),
      ),
    );
}

export async function closeRunUndelivered(
  runId: string,
  userId: string,
  reason: string,
): Promise<void> {
  const [closed] = await db
    .update(orchestrationRuns)
    .set({
      state: ORCH_STATE.ERROR,
      outcome: ORCHESTRATION_OUTCOME.ERROR,
      finishedAt: new Date(),
      payload: sql`jsonb_set(COALESCE(payload, '{}'), '{error}', to_jsonb(${`Dispatch failed before the prompt reached the agent: ${reason}`}::text))`,
    })
    .where(
      and(
        eq(orchestrationRuns.id, runId),
        eq(orchestrationRuns.userId, userId),
        isNull(orchestrationRuns.finishedAt),
      ),
    )
    .returning();
  if (closed) {
    void emitRunEvent(runId, userId, "closed", {
      outcome: ORCHESTRATION_OUTCOME.ERROR,
      by: "runner-nack",
      reason,
    });
    // This path bypasses updateOrchestrationRun, so it must emit its own
    // chat notification — a chat dispatch that never reached a runner is
    // exactly the close the operator most needs to hear about.
    void notifyRunClosed(closed);
    // ...and advance the ladder, for the reason that notification alone is not
    // enough. `formatRunCloseMessage` self-gates on `payload.notifyOnClose`,
    // which ONLY human-initiated dispatches carry — so for autopilot and cron
    // dispatches the line above returns null and this close said nothing at
    // all. The ladder is the mechanism that exists to surface exactly that:
    // repeated failures with no human watching, escalating to an alert at the
    // `human` rung.
    //
    // Without it this was the one failing-close path feeding the ladder
    // nothing — `updateOrchestrationRun` advances, the reaper advances, this
    // did not — so a dispatch that dies BEFORE reaching an agent could never
    // build a streak no matter how often it happened. Measured on prod
    // 2026-09-21: six dispatches failed across FOUR projects (loki, kivvi,
    // solon, reparaturbonus-zh) in twelve hours on an exhausted Claude quota,
    // every one of them through here, and the newest alert in the table was
    // six days old. The fleet stopped executing and nothing said so.
    //
    // Derived, not assumed, via the same predicate the other two call sites
    // use — one rule for what a close does to a ladder. `lastOutcome` keeps
    // this honest downstream: the ladder already distinguishes a streak built
    // from undelivered dispatches from one built from an agent's failing work.
    if (ladderEffectForClose(closed.outcome).kind === "advance") {
      void advanceEscalation({
        userId,
        projectKey: closed.projectKey,
        runId,
        outcome: closed.outcome ?? ORCHESTRATION_OUTCOME.ERROR,
        error: `Dispatch failed before the prompt reached the agent: ${reason}`,
      });
    }
  }
}

/**
 * Recent successful runs for one project — feeds the OC promote backfill so a
 * dropped run→wall emit self-heals (external ids are deterministic, OC
 * reconciles on them). Uses idx_orchestration_runs_recent_outcomes.
 */
export async function getRecentSuccessfulRuns(
  userId: string,
  projectKey: string,
  since: Date,
  limit = 10,
) {
  return db
    .select()
    .from(orchestrationRuns)
    .where(
      and(
        eq(orchestrationRuns.userId, userId),
        eq(orchestrationRuns.projectKey, projectKey),
        eq(orchestrationRuns.outcome, ORCHESTRATION_OUTCOME.SUCCESS),
        isNotNull(orchestrationRuns.finishedAt),
        gt(orchestrationRuns.finishedAt, since),
      ),
    )
    .orderBy(desc(orchestrationRuns.finishedAt))
    .limit(limit);
}

export async function getOrchestrationRunById(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(orchestrationRuns)
    .where(and(eq(orchestrationRuns.id, id), eq(orchestrationRuns.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Newest run for a project key — Terminal rail when no `?run=` was passed. */
export async function getLatestRunForProjectKey(userId: string, projectKey: string) {
  const key = projectKey.trim();
  if (!key) return null;
  // A parallel run's tab (`<project>~<runId8>`, lib/run-tab.ts) names its run:
  // match the base project AND that run, or "latest for the project" answers
  // with the other lane — or, keyed on the raw alias, with nothing at all.
  const lane = runLaneOfTab(key);
  const [row] = await db
    .select()
    .from(orchestrationRuns)
    .where(
      and(
        eq(orchestrationRuns.userId, userId),
        sql`lower(${orchestrationRuns.projectKey}) = lower(${lane?.project ?? key})`,
        lane
          ? sql`replace(${orchestrationRuns.id}::text, '-', '') LIKE ${`${lane.runPrefix}%`}`
          : undefined,
      ),
    )
    .orderBy(sql`(${orchestrationRuns.finishedAt} IS NULL) DESC`, desc(orchestrationRuns.startedAt))
    .limit(1);
  return row ?? null;
}

/** Batch lookup for feedback work-phase enrichment. */
export async function getOrchestrationRunsByIds(userId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, typeof orchestrationRuns.$inferSelect>();
  const rows = await db
    .select()
    .from(orchestrationRuns)
    .where(and(eq(orchestrationRuns.userId, userId), inArray(orchestrationRuns.id, ids)));
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Runs behind a REPORTER's own feedback rows — deliberately not owner-scoped.
 *
 * getOrchestrationRunsByIds above filters by `userId` because its caller is
 * the operator reading their own fleet. A reporter is a different person: they
 * filed a report on someone else's project, so the run that is fixing it is
 * owned by that someone else and an owner filter would return nothing, which
 * is precisely how the reporter page ended up with no progress to show.
 *
 * Authorization therefore comes from the REPORT, not the run: the caller has
 * already proved `site_feedback.reporter_user_id = <this user>` and passes the
 * `dispatched_run_id` values off those rows and nothing else. Passing ids from
 * anywhere else would hand a user runs they have no claim on.
 *
 * Only the columns the work-phase layer consumes are selected, and none of
 * them is rendered to the reporter — src/lib/feedback/reporter-view.ts writes
 * its own sentences from the derived phase. See that file for the boundary.
 */
export async function getRunsByIdsForReporter(ids: string[]) {
  if (ids.length === 0) return new Map<string, typeof orchestrationRuns.$inferSelect>();
  const rows = await db.select().from(orchestrationRuns).where(inArray(orchestrationRuns.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function cleanupStaleOrchestrationRuns(userId?: string) {
  // Did this run's project produce a handoff AFTER the run started? project_states
  // holds the box-pushed session state; a ready_at / session_updated_at newer
  // than started_at means the agent actually worked — the close just didn't fire.
  // Such a run is `partial` (progress), NOT a `timeout` failure. Only a run with
  // no evidence of work is a real timeout. (2026-07-11: reaping working agents as
  // timeout was inflating the fleet-pulse "Stalled" — truthseeker generated at
  // 05:00:43 yet its run was stamped timeout at 05:00:02.)
  // Same freshness floor the CLOSER uses (runEffectiveStartMs): `deliveredAt`
  // — the runner's ack of the prompt — beats `started_at`, which is merely when
  // the row was created and can precede delivery by a minute or more. When the
  // two disagreed, a handoff landing in that window counted as work HERE
  // (→ 'partial') while closeRunFromSession rightly judged it stale and left the
  // run open — so the run was reaped with a partial verdict and a NULL summary,
  // recording a failure whose reason nobody could read. One floor, both paths.
  const effectiveStart = runLifeStartSql("orchestration_runs");
  const wroteAfterStart = sql`EXISTS (
    SELECT 1 FROM project_states ps
    WHERE ps.user_id = ${orchestrationRuns.userId}
      AND lower(ps.project_key) = lower(${orchestrationRuns.projectKey})
      AND GREATEST(ps.ready_at, ps.session_updated_at) > ${effectiveStart}
  )`;
  // Alive = a long task, not a dead run. Don't reap it; it closes from its own
  // handoff, or a later tick reaps it once it goes quiet.
  //
  // Liveness must come from the runner's HEARTBEAT (`runtime_observed_at`), not
  // from handoff freshness (`session_updated_at`): a handoff is written at the
  // END of a turn, so a genuinely working agent looks dead the whole time it is
  // working. That inversion is why datacat's run was stamped `timeout` at 05:00
  // on 2026-08-02 while its agent went on writing until 11:01 — the run record
  // called a healthy agent dead. `agent_running` is the runner's claim that a
  // process exists; the heartbeat is what makes that claim still trustworthy.
  const liveNow = sql`EXISTS (
    SELECT 1 FROM project_states ps
    WHERE ps.user_id = ${orchestrationRuns.userId}
      AND lower(ps.project_key) = lower(${orchestrationRuns.projectKey})
      AND ps.agent_running = true
      AND ps.runtime_observed_at > NOW() - ${sql.raw(`INTERVAL '${Math.round(RUNNER_OFFLINE_THRESHOLD_MS / 1000)} seconds'`)}
  )`;

  // `agent_running` is "a process exists", not "it is working on MY prompt" —
  // and an idle agent sitting at a ready prompt has a process too. So liveness
  // alone let a run nobody had started be sheltered for the full MAX_RUN_HOURS.
  //
  // The runner already knows the difference and says so: after typing a prompt
  // in it re-checks the session, and when the agent never reacted it acks
  // `verified: false` ("the keystrokes landed but the agent isn't generating").
  // That is a positive statement about THIS run, so it outranks a project-wide
  // heartbeat. Only an explicit false counts — a null verdict is "no claim
  // made" and must not change behaviour.
  //
  // Deliberately narrow: a genuinely working agent still writes no handoff
  // until its turn ends, so liveness must keep sheltering it (datacat wrote
  // until 11:01 after being stamped `timeout` at 05:00). This disqualifies only
  // runs the runner itself reported as never having started.
  const runNeverStarted = sql`EXISTS (
    SELECT 1 FROM pending_commands pc
    WHERE pc.payload->>'runId' = ${orchestrationRuns.id}::text
      AND pc.executed_at IS NOT NULL
      AND pc.result->>'verified' = 'false'
  )`;

  const staleWhere = and(
    // Both un-terminal states: "running" (runner picked it up) and "waiting"
    // (opened but never closed). The local-runtime path opens runs as
    // "waiting" and closes them from the session handoff; if the agent never
    // writes a ready handoff (tab closed, process killed), the run would
    // otherwise linger open forever — reap it like a dead runner.
    inArray(orchestrationRuns.state, [ORCH_STATE.WAITING, ORCH_STATE.RUNNING]),
    // Stale by its WORKING life, not its age: a run that waited an hour in
    // line was not an hour into its work (see runLifeStartSql).
    sql`${effectiveStart} < NOW() - INTERVAL '1 minute' * ${STALE_RUN_MINUTES}`,
    // A run still waiting its turn is not stale at all — it has not been
    // allowed to start. The gate is withholding its command because an older
    // run holds the lane; reaping it here stamped `timeout` on work that never
    // got a chance, and then the command purge (which follows the run) dropped
    // the job itself — the 2026-08-24 "four of five feedback fixes lost" class,
    // reached by a different road. Bounded, not a shelter forever: the lane
    // holder is itself reaped by the rules above, and the gate stops honouring
    // it past MAX_RUN_HOURS.
    sql`NOT (
      (${orchestrationRuns.payload}->>'deliveredAt') IS NULL
      AND EXISTS (${olderOpenRunSql(
        sql`(orchestration_runs.started_at, orchestration_runs.id)`,
        sql`orchestration_runs.user_id`,
        sql`orchestration_runs.project_key`,
      )})
    )`,
    // Live agents are spared — but only up to a hard ceiling, so a wedged
    // process that keeps its heartbeat alive can't hold a run open forever,
    // and never when the runner has already said this run never started.
    sql`(NOT ${liveNow} OR ${runNeverStarted} OR ${effectiveStart} < NOW() - make_interval(hours => ${MAX_RUN_HOURS}))`,
  );
  const reaped = await db
    .update(orchestrationRuns)
    .set({
      // done (worked) vs error (dead). A reaped run must record a terminal
      // OUTCOME (not null) so it can't silently vanish from the streak/stats.
      state: sql`CASE WHEN ${wroteAfterStart} THEN 'done' ELSE 'error' END`,
      // Three facts, three names. `runNeverStarted` is the runner's ack that
      // it injected the prompt but never saw the agent start generating — it
      // was already computed above (to disqualify liveness sheltering) and
      // then THROWN AWAY at stamping time, so a run no agent was ever seen
      // working on got recorded as "the agent ran out of time". 29 of 157
      // timeouts measured 2026-08-26 were in this class, and they advanced the
      // escalation ladders of the projects whose prompts went unanswered —
      // surf-your-life reached the `human` rung with ten such runs behind it.
      //
      // `unconfirmed`, not `undelivered`: that name belongs to the stronger
      // signal (a runner NACK → closeRunUndelivered) and this evidence does
      // not reach it.
      //
      // wroteAfterStart is checked FIRST: evidence that work landed outranks
      // an ack saying it never started.
      outcome: sql`CASE
        WHEN ${wroteAfterStart} THEN 'partial'
        WHEN ${runNeverStarted} THEN 'unconfirmed'
        ELSE 'timeout' END`,
      // Truthful duration: the run ended at the timeout threshold, not when the
      // janitor noticed. (Stamping reap-time once produced "51h" durations.)
      // Two corrections, both from the same 2026-09-17 pair of runs. The
      // threshold is measured from the run's working life, like the window
      // that triggers it. And it is never EARLIER than the last output the
      // runner saw: the run ahead was stamped finished at 16:48:37 while its
      // own heartbeat reported output at 16:48:14 and it was not reaped until
      // 17:15 — a backdated close that made the overlap with the next run
      // invisible in the ledger. Capped at NOW() so it can never be future.
      finishedAt: sql`LEAST(
        NOW(),
        GREATEST(
          ${effectiveStart} + make_interval(mins => ${STALE_RUN_MINUTES}),
          (${orchestrationRuns.payload}->>'lastProgressAt')::timestamptz
        )
      )`,
      // A `partial` run did not fail, so its explanation goes to `note`
      // (neutral) and a real timeout keeps `error` (red). Both used to land in
      // `error`, which is how a success ended up styled as a failure and
      // phrased in reaper vocabulary.
      payload: sql`CASE
        WHEN ${wroteAfterStart}
          THEN jsonb_set(COALESCE(payload, '{}'), '{note}', to_jsonb(${EXECUTOR_COPY.honesty.reapedButHandoffWritten}::text))
        WHEN ${runNeverStarted}
          THEN jsonb_set(COALESCE(payload, '{}'), '{error}', to_jsonb(${EXECUTOR_COPY.honesty.dispatchNeverConfirmed}::text))
        ELSE jsonb_set(COALESCE(payload, '{}'), '{error}', to_jsonb('Timed out — run exceeded maximum duration and was cleaned up'::text))
      END`,
    })
    // No userId (the cron janitor) → reap across ALL users; the page-load call
    // sites keep passing their own userId for scope hygiene.
    .where(userId ? and(eq(orchestrationRuns.userId, userId), staleWhere) : staleWhere)
    // Full rows: notifyRunClosed below needs payload (notifyOnClose, error) and
    // finishedAt, not just the reap bookkeeping columns.
    .returning();

  // Honesty backstop: a `timeout` verdict means "no evidence of work", but the
  // handoff check above only sees project_states — a box agent that pushed a
  // branch/PR and died before writing a handoff looks identical to a dead run.
  // Check the repo itself and correct such verdicts to `partial`. Fire-and-
  // forget: GitHub lookups must never slow a reap (page-load call sites).
  if (reaped.some((r) => r.outcome === ORCHESTRATION_OUTCOME.TIMEOUT)) {
    void correctTimeoutReapsWithRepoEvidence(reaped);
  }
  // A run stamped `partial` above was stamped so because the agent HAD saved a
  // handoff — yet the UPDATE copies none of it, leaving a verdict with nothing
  // behind it (the NULL-summary partial this function's own freshness-floor
  // comment names as the state to avoid). Give it the handoff back. Attaches
  // evidence only: the outcome is not re-judged. Fire-and-forget, like the
  // evidence corrector above.
  if (reaped.some((r) => r.outcome === ORCHESTRATION_OUTCOME.PARTIAL && r.summary == null)) {
    void attachHandoffToReapedPartials(reaped);
  }
  // Reaped closes bypass updateOrchestrationRun, so advance ladders here.
  // Only genuinely failing outcomes count (timeout yes, partial no — same
  // isFailingOutcome predicate as the funnel and the brake). Note the evidence
  // corrector above may later flip a timeout→partial; that correction doesn't
  // rewind the ladder — a success resolves it, which is the honest reset.
  for (const r of reaped) {
    // Same single predicate as the funnel above. Reaped closes are failing in
    // practice, but deriving it rather than assuming keeps one rule for what a
    // close does to a ladder — and `correctTimeoutReapsWithRepoEvidence` above
    // can flip a timeout to `partial`, which must resolve, not advance.
    if (ladderEffectForClose(r.outcome).kind === "advance") {
      void advanceEscalation({
        userId: r.userId,
        projectKey: r.projectKey,
        runId: r.id,
        outcome: r.outcome ?? "timeout",
        error: "Timed out — run exceeded maximum duration and was cleaned up",
      });
    }
    // ...and announce them, for the same reason. The funnel notifies on ANY
    // close (updateOrchestrationRun), so a run that SUCCEEDS told the operator
    // while a run that DIED said nothing — failure was the one outcome the
    // product kept to itself. That asymmetry is how visitor-feedback fixes sat
    // "in progress" for weeks after their runs had timed out: the inbox looked
    // busy because the only thing that could have contradicted it was silent.
    //
    // Self-gating, so this is not a new noise source: formatRunCloseMessage
    // returns null unless payload.notifyOnClose is set, which only
    // human-initiated dispatches carry — autopilot churn stays quiet.
    //
    // Deliberately NOT resolveFeedbackForRun: that helper resolves
    // unconditionally and the reaper never stamps success, so calling it here
    // would mark feedback "shipped" because its fix run DIED.
    void notifyRunClosed(r);
  }
  return reaped;
}

/**
 * All currently-open runs (no terminal state yet), oldest first — the work-list
 * for the cron close-sweep. minAgeMinutes skips runs that just started so the
 * sweep never races a dispatch that hasn't produced a handoff yet.
 */
export async function listOpenRuns(minAgeMinutes = 5) {
  return db
    .select({
      id: orchestrationRuns.id,
      userId: orchestrationRuns.userId,
      adapter: orchestrationRuns.adapter,
      projectKey: orchestrationRuns.projectKey,
      startedAt: orchestrationRuns.startedAt,
      finishedAt: orchestrationRuns.finishedAt,
      // Parallel runs (phase 2 worktree-per-agent) carry their derived tab in
      // payload.sessionTab — the close path matches pushed handoffs on it.
      payload: orchestrationRuns.payload,
    })
    .from(orchestrationRuns)
    .where(
      and(
        inArray(orchestrationRuns.state, [ORCH_STATE.WAITING, ORCH_STATE.RUNNING]),
        isNull(orchestrationRuns.finishedAt),
        lt(orchestrationRuns.startedAt, new Date(Date.now() - minAgeMinutes * 60 * 1000)),
      ),
    )
    .orderBy(orchestrationRuns.startedAt);
}

/**
 * Is this project busy for this user — i.e. is another agent's run AHEAD of
 * ours? The SSOT "busy" predicate for per-project dispatch serialization.
 *
 * Gates on run AGE, not mere existence: busy iff an OPEN run (finishedAt IS
 * NULL, within the stale-reap window) for this project is OLDER than our own
 * run `excludeRunId`. This is what makes serialization FIFO WITHOUT deadlock —
 * every queued dispatch opens its own run, so "any other open run = busy" would
 * have queued dispatches block each other forever; "oldest open run wins" lets
 * them drain in creation order. The (started_at, id) tuple compare also
 * self-excludes (a run is never older than itself) and breaks the sub-µs
 * started_at tie deterministically. The floor is laneLifeFloorSql — the
 * reaper's own ceiling, so a crashed run cannot wedge a project forever and a
 * live one is never treated as gone while the reaper still shelters it. With
 * no excludeRunId, ANY open run counts as busy.
 */
export async function isProjectBusy(
  userId: string,
  projectKey: string,
  opts: { excludeRunId?: string } = {},
): Promise<boolean> {
  const conds = [
    eq(orchestrationRuns.userId, userId),
    eq(orchestrationRuns.projectKey, projectKey),
    isNull(orchestrationRuns.finishedAt),
    // The same floor the claim gate applies (laneLifeFloorSql): a run stays
    // busy until the reaper closes it, not until a shorter timer of our own
    // lapses. This check decides inject-directly vs queue, so a floor shorter
    // than the reaper's typed a second prompt into a live agent's PTY.
    laneLifeFloorSql("orchestration_runs"),
    // A parallel lane (derived tab, own worktree) does not occupy the base
    // lane — the claim gate already skips it (olderOpenRunSql). Counting it
    // here made a project with a free base lane look busy, so the next
    // dispatch forked ANOTHER lane instead of taking the free one.
    sql`${orchestrationRuns.payload}->>'sessionTab' IS NULL`,
  ];
  if (opts.excludeRunId) {
    // Only runs strictly older than ours (by started_at, then id) block us.
    conds.push(
      sql`(${orchestrationRuns.startedAt}, ${orchestrationRuns.id}) < (SELECT own.started_at, own.id FROM orchestration_runs own WHERE own.id = ${opts.excludeRunId})`,
    );
  }
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(orchestrationRuns)
    .where(and(...conds))
    .limit(1);
  return !!row;
}

/**
 * Add fields to a run's payload, touching nothing else. Returns false when no
 * such run exists.
 *
 * A MERGE, not updateOrchestrationRun — that sets `payload` wholesale, so
 * stamping one field by writing a fresh payload dropped every field it did not
 * restate. Among them `notifyOnClose` and `conversationId`: the two that make a
 * closed run report back to the thread it came from and to the operator's
 * phone. (Found giving a run its parallel lane: it would have finished in
 * silence.) Every "add this fact to a run that already exists" goes through
 * here.
 */
export async function mergeRunPayload(
  runId: string,
  patch: Partial<NonNullable<NewOrchestrationRun["payload"]>>,
): Promise<boolean> {
  const rows = await db
    .update(orchestrationRuns)
    .set({
      payload: sql`COALESCE(${orchestrationRuns.payload}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
    })
    .where(eq(orchestrationRuns.id, runId))
    .returning({ id: orchestrationRuns.id });
  return rows.length > 0;
}

/**
 * How many PARALLEL lanes (derived-tab runs, each in its own worktree) this
 * project has open right now, not counting `excludeRunId`.
 *
 * Same liveness floor as the base lane (laneLifeFloorSql), so a parallel run
 * the reaper still considers alive keeps its slot and a wedged one past the
 * reaper's ceiling stops holding it.
 */
export async function countOpenParallelLanes(
  userId: string,
  projectKey: string,
  excludeRunId?: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orchestrationRuns)
    .where(
      and(
        eq(orchestrationRuns.userId, userId),
        eq(orchestrationRuns.projectKey, projectKey),
        isNull(orchestrationRuns.finishedAt),
        sql`${orchestrationRuns.payload}->>'sessionTab' IS NOT NULL`,
        laneLifeFloorSql("orchestration_runs"),
        excludeRunId ? sql`${orchestrationRuns.id} <> ${excludeRunId}` : undefined,
      ),
    );
  return row?.n ?? 0;
}

/**
 * The latest run per project path, one row each.
 *
 * This used to SELECT every run for every path and keep the first per path in
 * JS. Measured on production 2026-09-24: 699 rows at ~1.26 KB each (~880 KB,
 * mostly the `summary` JSON) fetched and parsed to keep 32 — on every Control
 * poll, and since #863 on every /today load. Postgres time was ~2 ms either
 * way; the cost was transfer and parsing, and it grew with every run ever
 * recorded. DISTINCT ON returns only the rows the caller keeps.
 *
 * Semantics are unchanged: same ordering (started_at DESC, so a NULL
 * started_at still sorts first, as before) and the first row per path wins.
 */
export async function getLatestRunsByProjectPaths(userId: string, projectPaths: string[]) {
  if (projectPaths.length === 0) return new Map<string, typeof orchestrationRuns.$inferSelect>();

  const rows = await db
    .selectDistinctOn([orchestrationRuns.projectPath])
    .from(orchestrationRuns)
    .where(
      and(
        eq(orchestrationRuns.userId, userId),
        inArray(orchestrationRuns.projectPath, projectPaths),
      ),
    )
    .orderBy(orchestrationRuns.projectPath, desc(orchestrationRuns.startedAt));

  return new Map(rows.map((row) => [row.projectPath, row]));
}

export async function getProjectOrchestrationRuns(userId: string, projectId: string, limit = 20) {
  return db
    .select()
    .from(orchestrationRuns)
    .where(and(eq(orchestrationRuns.userId, userId), eq(orchestrationRuns.projectId, projectId)))
    .orderBy(desc(orchestrationRuns.startedAt))
    .limit(limit);
}

export type RecentOutcome = {
  outcome: OrchestrationOutcome;
  intent: OrchestrationTaskIntentId;
  finishedAt: Date;
};

/**
 * Batch variant of getRecentOutcomes — one round-trip for all projects on the
 * control panel instead of N queries. Used by /api/control to populate
 * ProjectState.recentOutcomes.
 */
export async function getRecentOutcomesByProjectKeys(
  userId: string,
  projectKeys: string[],
  perKeyLimit = 5,
): Promise<Map<string, OrchestrationOutcome[]>> {
  const result = new Map<string, OrchestrationOutcome[]>();
  if (projectKeys.length === 0) return result;

  const rows = await db
    .select({
      projectKey: orchestrationRuns.projectKey,
      outcome: orchestrationRuns.outcome,
      finishedAt: orchestrationRuns.finishedAt,
    })
    .from(orchestrationRuns)
    .where(
      and(
        eq(orchestrationRuns.userId, userId),
        inArray(orchestrationRuns.projectKey, projectKeys),
        isNotNull(orchestrationRuns.outcome),
        isNotNull(orchestrationRuns.finishedAt),
        // Same recency window as getRecentOutcomes — stale failures are history,
        // not a live streak on every project card.
        gt(orchestrationRuns.finishedAt, new Date(Date.now() - RECENT_OUTCOMES_WINDOW_MS)),
      ),
    )
    .orderBy(desc(orchestrationRuns.finishedAt));

  for (const r of rows) {
    if (!r.outcome) continue;
    const arr = result.get(r.projectKey) ?? [];
    if (arr.length < perKeyLimit) arr.push(r.outcome);
    result.set(r.projectKey, arr);
  }
  return result;
}

/**
 * "Recent" means RECENT: outcomes older than this are history, not current
 * state. Without this window, the July credential outage kept painting ✗
 * streaks on Control cards and the dispatch reasoner for weeks after the
 * failures stopped being news. SSOT here so every consumer (streak chips,
 * dispatch gates, nudge brake, dossier) ages out together.
 */
export const RECENT_OUTCOMES_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * Returns the most recent finished orchestration runs for a project, newest
 * first — bounded to RECENT_OUTCOMES_WINDOW_MS.
 * Backed by idx_orchestration_runs_recent_outcomes (partial index, finishedAt IS NOT NULL).
 * Used by the dispatch reasoner and ProjectCard streak chip.
 */
export async function getRecentOutcomes(
  userId: string,
  projectKey: string,
  opts: { intent?: OrchestrationTaskIntentId; limit?: number } = {},
): Promise<RecentOutcome[]> {
  const limit = opts.limit ?? 5;
  const conditions = [
    eq(orchestrationRuns.userId, userId),
    eq(orchestrationRuns.projectKey, projectKey),
    isNotNull(orchestrationRuns.outcome),
    isNotNull(orchestrationRuns.finishedAt),
    gt(orchestrationRuns.finishedAt, new Date(Date.now() - RECENT_OUTCOMES_WINDOW_MS)),
  ];
  if (opts.intent) conditions.push(eq(orchestrationRuns.intent, opts.intent));

  const rows = await db
    .select({
      outcome: orchestrationRuns.outcome,
      intent: orchestrationRuns.intent,
      finishedAt: orchestrationRuns.finishedAt,
    })
    .from(orchestrationRuns)
    .where(and(...conditions))
    .orderBy(desc(orchestrationRuns.finishedAt))
    .limit(limit);

  return rows
    .filter(
      (
        r,
      ): r is {
        outcome: OrchestrationOutcome;
        intent: OrchestrationTaskIntentId;
        finishedAt: Date;
      } => r.outcome !== null && r.finishedAt !== null,
    )
    .map((r) => ({ outcome: r.outcome, intent: r.intent, finishedAt: r.finishedAt }));
}

/**
 * Runner heartbeat: the agent's PTY printed something since the last beat.
 * Stamps payload.lastProgressAt on the OPEN run only; returns false once the
 * run is closed so the runner stops reporting. This is the signal Feedback's
 * work phase reads to say "Working · 12 min" instead of guessing from the
 * delivery time (see src/lib/run-progress.ts).
 */
export async function stampRunProgress(
  runId: string,
  userId: string,
  /** Why the agent is quiet, when the runner can tell. Cleared when it prints. */
  blocked: string | null = null,
): Promise<boolean> {
  const rows = await db
    .update(orchestrationRuns)
    .set({
      payload: sql`jsonb_set(
        jsonb_set(COALESCE(payload, '{}'), '{lastProgressAt}', ${JSON.stringify(new Date().toISOString())}::jsonb),
        '{blocked}', ${JSON.stringify(blocked)}::jsonb)`,
    })
    .where(
      and(
        eq(orchestrationRuns.id, runId),
        eq(orchestrationRuns.userId, userId),
        isNull(orchestrationRuns.finishedAt),
      ),
    )
    .returning({ id: orchestrationRuns.id });
  return rows.length > 0;
}

/** Cache the fix ledger on the run (payload.fix). Closed runs included — the
 *  PR merges and deploys long after the run ended. */
export async function stampRunFix(runId: string, userId: string, fix: FixShipping): Promise<void> {
  await db
    .update(orchestrationRuns)
    .set({
      payload: sql`jsonb_set(COALESCE(payload, '{}'), '{fix}', ${JSON.stringify(fix)}::jsonb)`,
    })
    .where(and(eq(orchestrationRuns.id, runId), eq(orchestrationRuns.userId, userId)));
}
/**
 * The operator's most recent runs across every project, newest first — the
 * read Loki uses to answer "did my agent finish?" and "what is waiting?".
 *
 * Bounded and narrow on purpose: no `raw`/`resultText` blobs, just the columns
 * a one-line status needs. Filtering by state is optional so the same read
 * serves "what's waiting" (states=[waiting]) and "what happened today" (any).
 */
export type RecentRunRow = {
  id: string;
  projectKey: string;
  adapter: string;
  intent: string;
  state: string;
  outcome: OrchestrationOutcome | null;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
  note: string | null;
  summaryStatus: string | null;
  summaryDone: string | null;
  summaryNext: string | null;
  commit: string | null;
};

export async function listRecentRuns(
  userId: string,
  opts: {
    limit?: number;
    states?: OrchestrationState[];
    projectKey?: string;
    sinceMs?: number;
  } = {},
): Promise<RecentRunRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const conditions = [eq(orchestrationRuns.userId, userId)];
  if (opts.states && opts.states.length > 0)
    conditions.push(inArray(orchestrationRuns.state, opts.states));
  if (opts.projectKey) conditions.push(eq(orchestrationRuns.projectKey, opts.projectKey));
  if (opts.sinceMs)
    conditions.push(gt(orchestrationRuns.startedAt, new Date(Date.now() - opts.sinceMs)));

  const rows = await db
    .select({
      id: orchestrationRuns.id,
      projectKey: orchestrationRuns.projectKey,
      adapter: orchestrationRuns.adapter,
      intent: orchestrationRuns.intent,
      state: orchestrationRuns.state,
      outcome: orchestrationRuns.outcome,
      startedAt: orchestrationRuns.startedAt,
      finishedAt: orchestrationRuns.finishedAt,
      payload: orchestrationRuns.payload,
      summary: orchestrationRuns.summary,
    })
    .from(orchestrationRuns)
    .where(and(...conditions))
    .orderBy(desc(orchestrationRuns.startedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    projectKey: r.projectKey,
    adapter: r.adapter,
    intent: r.intent,
    state: r.state,
    outcome: r.outcome ?? null,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt ?? null,
    error: r.payload?.error ?? null,
    note: r.payload?.note ?? null,
    summaryStatus: r.summary?.status ?? null,
    summaryDone: r.summary?.done ?? null,
    summaryNext: r.summary?.next ?? null,
    commit: r.summary?.commit ?? null,
  }));
}

/** Runs started inside `sinceMs`, tallied per state — the fleet's pulse in one read. */
export async function countRunsByStateSince(
  userId: string,
  sinceMs: number,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ state: orchestrationRuns.state, n: sql<number>`count(*)::int` })
    .from(orchestrationRuns)
    .where(
      and(
        eq(orchestrationRuns.userId, userId),
        gt(orchestrationRuns.startedAt, new Date(Date.now() - sinceMs)),
      ),
    )
    .groupBy(orchestrationRuns.state);
  return Object.fromEntries(rows.map((r) => [r.state, Number(r.n)]));
}

/** Stamp a one-shot feedback auto-retry so cron cannot loop. jsonb_set — never
 *  replace the whole payload (that would drop deliveredAt / projectKey). */
export async function stampFeedbackAutoRetried(
  runId: string,
  userId: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const stamp = new Date().toISOString();
  let payloadSql = sql`jsonb_set(COALESCE(payload, '{}'), '{feedbackAutoRetriedAt}', ${JSON.stringify(stamp)}::jsonb)`;
  if (extra?.priorRunId && typeof extra.priorRunId === "string") {
    payloadSql = sql`jsonb_set(${payloadSql}, '{priorRunId}', ${JSON.stringify(extra.priorRunId)}::jsonb)`;
  }
  await db
    .update(orchestrationRuns)
    .set({ payload: payloadSql })
    .where(and(eq(orchestrationRuns.id, runId), eq(orchestrationRuns.userId, userId)));
}

/** Persist the pending command id on the run so Watch can poll live status. */
export async function stampRunCommandId(
  runId: string,
  userId: string,
  commandId: string,
): Promise<void> {
  await db
    .update(orchestrationRuns)
    .set({
      payload: sql`jsonb_set(COALESCE(payload, '{}'), '{commandId}', ${JSON.stringify(commandId)}::jsonb)`,
    })
    .where(
      and(
        eq(orchestrationRuns.id, runId),
        eq(orchestrationRuns.userId, userId),
        isNull(orchestrationRuns.finishedAt),
      ),
    );
}
