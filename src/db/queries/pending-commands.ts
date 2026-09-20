import { db } from "@/db";
import {
  pendingCommands,
  type NewPendingCommand,
  type InjectPayload,
  type DispatchPayload,
  type SwitchAgentPayload,
  type AutoContinuePayload,
  type TabPayload,
  type LaunchAgentPayload,
  type RunnerChannel,
} from "@/db/schema/pending-commands";
import { eq, isNull, isNotNull, and, inArray, notInArray, desc, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { FailedCommand } from "@/lib/control-types";
import { STALE_RUN_MINUTES } from "./orchestration-runs";
import { requireNotDemo } from "@/lib/demo-guard";

export async function getCommandById(id: string) {
  const [row] = await db.select().from(pendingCommands).where(eq(pendingCommands.id, id)).limit(1);
  return row ?? null;
}

/**
 * Runner EXECUTION health — distinct from the push/sync heartbeat. A Fleet
 * Runner can keep pushing snapshots ("Connected · sync just now") while its
 * command-execution loop is hung, so every dispatch silently queues forever and
 * agents never move. This detects exactly that: commands accepted but not
 * executed past a grace window (ignoring ancient leftovers). Surfaced in the
 * fleet header so a stalled runner is loud instead of masquerading as healthy.
 * (Dogfood 2026-06-19: a hung runner wasted hours while showing "Connected".)
 */
export async function getRunnerExecutionStall(userId: string, graceSeconds = 120) {
  const [row] = await db
    .select({
      stalledCount: sql<number>`count(*)::int`,
      oldestSeconds: sql<number>`coalesce(extract(epoch from (now() - min(created_at)))::int, 0)`,
      // Which projects the stuck commands target — so the banner can say
      // "2 dispatches for orangecat" instead of an untraceable count.
      tabs: sql<
        string[]
      >`coalesce(array_agg(distinct coalesce(payload->>'projectKey', payload->>'tab')) filter (where coalesce(payload->>'projectKey', payload->>'tab') is not null), '{}')`,
    })
    .from(pendingCommands)
    .where(
      and(
        eq(pendingCommands.userId, userId),
        isNull(pendingCommands.executedAt),
        // In-flight, not stalled: a claimed command is being executed right now
        // (local dispatch legitimately holds its claim 20-35s; hosted Hermes
        // runs for minutes). Genuinely dead claims are reclaimed to unclaimed
        // by reclaimStalePendingCommands and then count again.
        isNull(pendingCommands.claimedAt),
        sql`created_at < now() - interval '1 second' * ${graceSeconds}`,
        sql`created_at > now() - interval '2 hours'`,
        // A dispatch waiting its turn behind an older open run for the same
        // project is QUEUED, not stalled — the claim gate skips it on purpose.
        // Counting those had Control shouting "Restart the desktop app" every
        // time a project ran longer than the grace window with a follow-up
        // queued (any 2-minute run + one queued dispatch = false alarm). Only a
        // command the runner was ALLOWED to claim and didn't is evidence of a
        // hung execution loop.
        fifoEligibilitySql(),
      ),
    );
  const stalledCount = row?.stalledCount ?? 0;
  return {
    stalled: stalledCount > 0,
    stalledCount,
    oldestSeconds: row?.oldestSeconds ?? 0,
    tabs: (row?.tabs ?? []).slice(0, 5),
  };
}

/**
 * Per-project serialization gate (FIFO by run age) — SSOT, used by BOTH the
 * claim query and the stall detector so "waiting its turn" can never be
 * mistaken for "stalled". A dispatch/inject is eligible only when its own run
 * is the OLDEST open run for the project — i.e. NO open run is older (by
 * started_at, then id) than the run its payload.runId points to. Gating on age
 * (not mere existence) is what avoids deadlock: every queued dispatch opens its
 * own run, so "any other open run = busy" would have them block each other;
 * "oldest wins" drains them in order. Commands with no projectKey/runId
 * (peek, lifecycle — which open no run) are never blocked. The
 * started_at floor mirrors cleanupStaleOrchestrationRuns so a crashed run
 * can't wedge a project past STALE_RUN_MINUTES.
 *
 * An older open run blocks until it CLOSES (finished_at), not until its
 * prompt is delivered — releasing on delivery merged two dispatches into one
 * agent session sharing one summary. Derived-tab runs (payload.sessionTab,
 * parallel worktree-per-agent) own an isolated tab, so they neither block
 * base-tab commands nor wait on them.
 */
/**
 * The runs that hold a project's lane, as ONE definition.
 *
 * `fifoEligibilitySql` (the gate) and `findQueueBlockers` (what the UI shows a
 * person) have to mean the same thing by "busy", or the product ends up
 * withholding a command for one reason and explaining it with another — which
 * is exactly what it did: a dispatch queued correctly behind an older run was
 * reported as "Retry — or Open Terminal for why it never started", sending the
 * operator to check a Fleet Runner that was working perfectly (2026-09-17).
 *
 * So both callers compose this fragment and neither restates the rule. The
 * caller passes its own run's identity as SQL, because the gate reads it out
 * of a command payload while the lookup reads it off the run row.
 */
function olderOpenRunSql(ownTuple: SQL, userId: SQL, projectKey: SQL) {
  return sql`
      SELECT 1 FROM orchestration_runs r
      WHERE r.user_id = ${userId}
        AND r.project_key = ${projectKey}
        AND r.finished_at IS NULL
        AND r.started_at > NOW() - INTERVAL '1 minute' * ${STALE_RUN_MINUTES}
        AND r.payload->>'sessionTab' IS NULL
        -- Orphan open runs must not block the queue: a run with NO pending
        -- command row at all was never enqueued (or its command was deleted) —
        -- that was the "Install queued → empty Terminal" wedge. But a run
        -- whose command was EXECUTED is an agent session that owns the tab:
        -- it must keep blocking until the run CLOSES (finished_at) or goes
        -- stale via the started_at floor above. Releasing on ack (executed_at)
        -- reintroduced the documented merged-sessions regression: dispatch B's
        -- prompt typed into A's still-working PTY.
        AND EXISTS (
          SELECT 1 FROM pending_commands pc
          WHERE pc.user_id = r.user_id
            AND pc.payload->>'runId' = r.id::text
        )
        AND (r.started_at, r.id) < ${ownTuple}`;
}

/** What is ahead of these runs in their project's lane, if anything. */
export type QueueBlocker = {
  /** The open run that holds the lane. */
  runId: string;
  startedAt: Date;
  /** Its prompt label ("Next Best Task"), when the dispatch recorded one. */
  label: string | null;
};

/**
 * For each given run, the OLDEST open run ahead of it in its project's lane.
 *
 * A run with no entry is not being withheld by the gate — whatever else is
 * wrong with it, "waiting its turn" is not the explanation. Reads the same
 * predicate the claim query enforces (see olderOpenRunSql), so the sentence a
 * person is shown and the decision the queue actually made cannot drift apart.
 */
export async function findQueueBlockers(runIds: string[]): Promise<Map<string, QueueBlocker>> {
  const ids = runIds.filter(Boolean);
  const out = new Map<string, QueueBlocker>();
  if (ids.length === 0) return out;
  const rows = await db.execute<{
    own_id: string;
    blocker_id: string;
    blocker_started_at: Date;
    blocker_label: string | null;
  }>(sql`
    SELECT own.id AS own_id,
           b.id AS blocker_id,
           b.started_at AS blocker_started_at,
           b.payload->>'promptLabel' AS blocker_label
      FROM orchestration_runs own
      JOIN LATERAL (
        ${olderOpenRunSql(sql`(own.started_at, own.id)`, sql`own.user_id`, sql`own.project_key`)}
        ORDER BY r.started_at, r.id
        LIMIT 1
      ) blocked ON TRUE
      JOIN orchestration_runs b
        ON b.user_id = own.user_id
       AND b.project_key = own.project_key
       AND b.finished_at IS NULL
       AND b.payload->>'sessionTab' IS NULL
       AND (b.started_at, b.id) < (own.started_at, own.id)
     WHERE own.id IN (${sql.join(
       ids.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})
       AND own.finished_at IS NULL
       AND own.payload->>'sessionTab' IS NULL
     ORDER BY own.id, b.started_at, b.id`);
  for (const row of rows) {
    if (out.has(row.own_id)) continue; // ORDER BY put the oldest blocker first
    out.set(row.own_id, {
      runId: row.blocker_id,
      startedAt: row.blocker_started_at,
      label: row.blocker_label,
    });
  }
  return out;
}

function fifoEligibilitySql() {
  return sql`(
    ${pendingCommands.type} NOT IN ('dispatch','inject')
    OR ${pendingCommands.payload}->>'projectKey' IS NULL
    OR ${pendingCommands.payload}->>'runId' IS NULL
    OR EXISTS (
      SELECT 1 FROM orchestration_runs own
      WHERE own.id = (${pendingCommands.payload}->>'runId')::uuid
        AND own.payload->>'sessionTab' IS NOT NULL
    )
    OR NOT EXISTS (
      ${olderOpenRunSql(
        sql`(
          SELECT own.started_at, own.id FROM orchestration_runs own
          WHERE own.id = (${pendingCommands.payload}->>'runId')::uuid
        )`,
        sql`${pendingCommands.userId}`,
        sql`${pendingCommands.payload}->>'projectKey'`,
      )}
    )
  )`;
}

export async function enqueuePendingCommand(
  command: Omit<NewPendingCommand, "id" | "createdAt">,
): Promise<string> {
  // Layer 2 of the demo sandbox (src/lib/demo-guard.ts). This row is the ONLY
  // way anything reaches the machine — Fleet Runner polls this table and types
  // the payload into a real shell. Guarding here rather than at the routes
  // means every present and future caller inherits it: a new dispatch endpoint,
  // a server action, a queue drain, a retry. The route policy can be widened by
  // mistake; this cannot be bypassed without deleting this line.
  await requireNotDemo(command.userId, command.type === "inject" ? "terminal" : "dispatch");

  const [row] = await db
    .insert(pendingCommands)
    .values(command)
    .returning({ id: pendingCommands.id });
  return row.id;
}

export async function enqueueInjectCommand(
  userId: string,
  payload: InjectPayload,
): Promise<string> {
  return enqueuePendingCommand({ userId, type: "inject", payload });
}

export async function enqueueDispatchCommand(
  userId: string,
  payload: DispatchPayload,
): Promise<string> {
  return enqueuePendingCommand({ userId, type: "dispatch", payload });
}

/** True when an unexecuted command already targets this project (inject or dispatch). */
export async function hasOpenPendingForProject(
  userId: string,
  projectKey: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: pendingCommands.id })
    .from(pendingCommands)
    .where(
      and(
        eq(pendingCommands.userId, userId),
        isNull(pendingCommands.executedAt),
        sql`(
          ${pendingCommands.payload}->>'projectKey' = ${projectKey}
          OR ${pendingCommands.payload}->>'tab' = ${projectKey}
        )`,
      ),
    )
    .limit(1);
  return !!row;
}

/** True when this run's dispatch/inject command is still queued (gate-held or
 *  runner offline) — the prompt was never delivered, so no session handoff can
 *  be this run's work. The close sweep uses this to skip such runs. */
export async function hasUndeliveredCommandForRun(userId: string, runId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: pendingCommands.id })
    .from(pendingCommands)
    .where(
      and(
        eq(pendingCommands.userId, userId),
        isNull(pendingCommands.executedAt),
        sql`${pendingCommands.payload}->>'runId' = ${runId}`,
      ),
    )
    .limit(1);
  return !!row;
}

/** Hosted runner (Phase 0): a read-only analysis/plan/review of a project's
 *  repo, executed on hosted compute rather than the operator's machine. Its own
 *  command type so it never collides with the local-runner dispatch/inject path. */
export type HostedAnalyzePayload = { projectKey: string; gitUrl: string; task: string };
export async function enqueueHostedAnalyzeCommand(
  userId: string,
  payload: HostedAnalyzePayload,
): Promise<string> {
  return enqueuePendingCommand({ userId, type: "hosted_analyze", payload });
}

/** Hosted runner Phase 1: a WRITE-class task dispatched to a coding agent
 *  (Hermes) on hosted compute — clone, run the agent in its own sandbox, return
 *  the work. Own type so it's distinct from the read-only hosted_analyze and
 *  from the local-runner dispatch path. `model` overrides HERMES_INFERENCE_MODEL. */
export type HostedDispatchPayload = {
  projectKey: string;
  gitUrl: string;
  task: string;
  model?: string;
  /** The tracked run this command executes, when the project is pinned to the
   *  hosted builder. The hosted runner closes it — with the PR as evidence —
   *  so the outcome reaches the thread that asked. Absent on the offline
   *  fallback, where the runner's own run is still expected to close. */
  runId?: string;
  projectId?: string;
};
export async function enqueueHostedDispatchCommand(
  userId: string,
  payload: HostedDispatchPayload,
): Promise<string> {
  return enqueuePendingCommand({ userId, type: "hosted_dispatch", payload });
}

/** Hosted runner: CREATE a new site (repo → register → box → deploy).
 *
 *  hosted_analyze reads a repo and hosted_dispatch changes one; neither can
 *  bring a site into existence, so every site so far was made by a person at a
 *  terminal — the one step of the factory that still needed a human to start it.
 *
 *  Its own type, and deliberately NOT a task string: the fields are a closed
 *  set, validated against a fixed grammar, and they reach `new-site.sh` as an
 *  argument vector. Nothing here is ever interpreted as a shell command or as an
 *  instruction to an agent, which is the whole difference between this and the
 *  tab-injection path. See src/lib/hosted-runner/new-site.ts. */
export type HostedNewSitePayload = {
  slug: string;
  title?: string;
  kind: string;
  status: string;
};
export async function enqueueHostedNewSiteCommand(
  userId: string,
  payload: HostedNewSitePayload,
): Promise<string> {
  return enqueuePendingCommand({ userId, type: "hosted_new_site", payload });
}

/** Taking a site down: the inverse of the payload above, same closed shape.
 *  `confirm:false` runs the script in plan mode, which touches nothing — that
 *  is what makes a preview safe to queue. See lib/hosted-runner/retire-site.ts. */
export type HostedRetireSitePayload = {
  slug: string;
  mode: string;
  repo: string;
  forceClient?: boolean;
  confirm: boolean;
};

export async function enqueueHostedRetireSiteCommand(
  userId: string,
  payload: HostedRetireSitePayload,
): Promise<string> {
  return enqueuePendingCommand({ userId, type: "hosted_retire_site", payload });
}

/**
 * How many sites this account has asked for since `since`.
 *
 * Counts REQUESTS, not successes, and that is deliberate: a caller firing ten
 * provisioning requests that all fail downstream has still done ten rounds of
 * work against a repo host, a DNS zone and a certificate authority, and a quota
 * that only counted the ones that worked would have stopped none of it.
 */
export async function countRecentNewSiteCommands(userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pendingCommands)
    .where(
      and(
        eq(pendingCommands.userId, userId),
        eq(pendingCommands.type, "hosted_new_site"),
        sql`${pendingCommands.createdAt} >= ${since}`,
      ),
    );
  return row?.n ?? 0;
}

export async function enqueueSwitchAgentCommand(
  userId: string,
  payload: SwitchAgentPayload,
): Promise<string> {
  return enqueuePendingCommand({ userId, type: "switch_agent", payload });
}

export async function enqueueAutoContinueCommand(
  userId: string,
  payload: AutoContinuePayload,
): Promise<string> {
  return enqueuePendingCommand({ userId, type: "auto_continue", payload });
}

export async function enqueueTabCommand(
  userId: string,
  type: "close_tab",
  payload: TabPayload,
): Promise<string> {
  return enqueuePendingCommand({ userId, type, payload });
}

export async function enqueueLaunchAgentCommand(
  userId: string,
  payload: LaunchAgentPayload,
): Promise<string> {
  return enqueuePendingCommand({ userId, type: "launch_agent", payload });
}

/** Live terminal: tell the runner to start/stop streaming a tab's screen.
 *  See docs/architecture/embedded-terminal.md. */
export async function enqueuePeekCommand(
  userId: string,
  type: "peek_start" | "peek_stop",
  payload: TabPayload,
): Promise<string> {
  return enqueuePendingCommand({ userId, type, payload });
}

/** Re-enqueues a failed (or delivered-but-unverified) command verbatim.
 *  Returns the new command id, or null when the source command doesn't
 *  exist, belongs to another user, or never actually failed. */
export async function retryFailedCommand(userId: string, id: string): Promise<string | null> {
  const [row] = await db
    .select({ type: pendingCommands.type, payload: pendingCommands.payload })
    .from(pendingCommands)
    .where(
      and(
        eq(pendingCommands.id, id),
        eq(pendingCommands.userId, userId),
        isNotNull(pendingCommands.executedAt),
        sql`((${pendingCommands.result}->>'ok') = 'false' OR (${pendingCommands.result}->>'verified') = 'false')`,
      ),
    )
    .limit(1);
  if (!row) return null;
  return enqueuePendingCommand({ userId, type: row.type, payload: row.payload });
}

// Atomically claims the next unclaimed command for one or more already
// authorized user IDs. API bearer routes must pass only the token owner's ID.
// FOR UPDATE SKIP LOCKED prevents two concurrent pollers from claiming the same row.
//
// Dispatch legitimately holds a claim while it launches an agent, verifies the
// prompt was submitted, and runs the delayed auth canary (normally 20-35s).
// A 10s lease reclaimed healthy work mid-handler, making Loki regress from
// "working" back to "queued" and handing the row to a second poller. Runner
// type filters now prevent the old incompatible-runner orphan case, so retain a
// 90s crash-recovery lease without duplicating live dispatches.
const STALE_CLAIM_SECONDS = 90;

// Hosted runs (Hermes clone→edit→PR) legitimately hold a claim for MINUTES —
// run-hermes has a 15-min timeout. The 90s local-dispatch lease would reclaim a
// healthy in-flight Hermes run, and a second drainer tick then re-runs it →
// duplicate branches/PRs (observed 2026-07-22). Give hosted command types a
// lease longer than the run timeout so only a genuinely dead run is reclaimed.
const HOSTED_STALE_CLAIM_SECONDS = 20 * 60;
// hosted_new_site belongs here for the same reason Hermes does: provisioning
// runs a repo creation, a box sync and a deploy, which takes minutes. On the 90s
// local-dispatch lease a healthy in-flight scaffold would be reclaimed and a
// second drainer would re-run it — and re-running THIS one does not duplicate a
// branch, it tries to create a second site on a slug the first is mid-way
// through claiming.
const HOSTED_COMMAND_TYPES = [
  "hosted_dispatch",
  "hosted_analyze",
  "hosted_new_site",
  "hosted_retire_site",
] as const;

// Commands queued while the runner was offline go stale fast: executing a
// days-old "inject into tab X" / "launch agent in Y" against a Zellij that has
// since changed just fails noisily and clutters Control. Purge unclaimed,
// unexecuted commands older than this before claiming, so the runner never
// drains an outdated backlog on reconnect. Generous enough that a healthy
// runner (drains in seconds) never trips it.
const STALE_COMMAND_MAX_AGE_MINUTES = 20;

/** Delete the offline backlog: unclaimed + unexecuted commands older than the
 *  staleness cutoff. The original dispatch is still recorded in
 *  control_audit_events, so nothing auditable is lost. Returns the count. */
export async function purgeStalePendingCommands(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const userFilter =
    userIds.length === 1
      ? eq(pendingCommands.userId, userIds[0])
      : inArray(pendingCommands.userId, userIds);
  const deleted = await db
    .delete(pendingCommands)
    .where(
      and(
        userFilter,
        isNull(pendingCommands.claimedAt),
        isNull(pendingCommands.executedAt),
        sql`${pendingCommands.createdAt} < NOW() - INTERVAL '1 minute' * ${STALE_COMMAND_MAX_AGE_MINUTES}`,
        // A dispatch/inject held by the per-project serialization gate is NOT an
        // offline backlog — it is legitimately waiting for the older run to close.
        // Purging it would silently drop the work AND leave its own open run
        // wedging the project.
        //
        // A queued command lives exactly as long as the run it belongs to, and
        // not one minute longer: the reaper is what bounds it (60 min for a dead
        // project, up to MAX_RUN_HOURS while an agent is genuinely alive), so
        // this needs no second timer of its own. It used to carry one — a flat
        // STALE_RUN_MINUTES from its own start — which did not match how long a
        // run may legitimately stay open. Real agent turns run for hours, so the
        // command was deleted at 60 min while the run ahead was still working
        // and the run behind it was still open. That dropped the user's work
        // silently, and the orphaned run then had nothing left to prove it was
        // undelivered (2026-08-24: four of five feedback fixes lost this way).
        sql`NOT (
        ${pendingCommands.type} IN ('dispatch','inject')
        AND ${pendingCommands.payload}->>'runId' IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM orchestration_runs own
          WHERE own.id = (${pendingCommands.payload}->>'runId')::uuid
            AND own.finished_at IS NULL
        )
      )`,
      ),
    )
    .returning({ id: pendingCommands.id });
  return deleted.length;
}

/** Commands claimed but never finished (runner crash/restart) become claimable again. */
export async function reclaimStalePendingCommands(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const userFilter =
    userIds.length === 1
      ? eq(pendingCommands.userId, userIds[0])
      : inArray(pendingCommands.userId, userIds);
  // Type-aware lease in two typed batches (a CASE around the lease param leaves
  // it type-unknown → `interval * unknown` → 42883). Hosted (Hermes) runs get a
  // much longer grace so a healthy multi-minute run is never reclaimed mid-flight
  // and double-run; local dispatch keeps the short lease.
  const hostedTypes = [...HOSTED_COMMAND_TYPES];
  const reclaimBatch = (typeCond: ReturnType<typeof inArray>, seconds: number) =>
    db
      .update(pendingCommands)
      .set({ claimedAt: null })
      .where(
        and(
          userFilter,
          isNotNull(pendingCommands.claimedAt),
          isNull(pendingCommands.executedAt),
          typeCond,
          sql`${pendingCommands.claimedAt} < NOW() - INTERVAL '1 second' * ${seconds}`,
        ),
      )
      .returning({ id: pendingCommands.id });
  const [hosted, local] = await Promise.all([
    reclaimBatch(inArray(pendingCommands.type, hostedTypes), HOSTED_STALE_CLAIM_SECONDS),
    reclaimBatch(notInArray(pendingCommands.type, hostedTypes), STALE_CLAIM_SECONDS),
  ]);
  return hosted.length + local.length;
}

export async function claimNextPendingCommand(
  userIds: string[],
  types?: string[],
  runnerChannel?: RunnerChannel,
) {
  if (userIds.length === 0) return null;
  await purgeStalePendingCommands(userIds);
  await reclaimStalePendingCommands(userIds);
  const userFilter =
    userIds.length === 1
      ? eq(pendingCommands.userId, userIds[0])
      : inArray(pendingCommands.userId, userIds);
  const cleanTypes = types?.map((type) => type.trim()).filter(Boolean) ?? [];
  const typeFilter = cleanTypes.length > 0 ? inArray(pendingCommands.type, cleanTypes) : undefined;
  const channelFilter = runnerChannel
    ? sql`(
        ${pendingCommands.payload}->>'channel' IS NULL
        OR ${pendingCommands.payload}->>'channel' = ${runnerChannel}
      )`
    : sql`${pendingCommands.payload}->>'channel' IS NULL`;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(pendingCommands)
      .where(
        and(
          userFilter,
          typeFilter,
          channelFilter,
          isNull(pendingCommands.claimedAt),
          // A busy project's rows are skipped so a different project's row is
          // claimed → cross-project parallelism intact. Runs INSIDE the FOR
          // UPDATE SKIP LOCKED tx (correct under concurrent pollers). Full gate
          // semantics documented on fifoEligibilitySql.
          fifoEligibilitySql(),
        ),
      )
      .orderBy(pendingCommands.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;
    await tx
      .update(pendingCommands)
      .set({ claimedAt: new Date() })
      .where(eq(pendingCommands.id, row.id));
    return row;
  });
}

export async function markCommandExecuted(
  id: string,
  userId: string,
  result: {
    ok: boolean;
    text?: string;
    error?: string;
    warning?: string;
    verified?: boolean;
    workspaceId?: string;
  },
): Promise<boolean> {
  const updated = await db
    .update(pendingCommands)
    // First ack wins: a double-claim's dedup re-ack ("already-done") once
    // clobbered the original rich result — including the "agent isn't
    // generating" warning — with a bare {ok:true}. COALESCE keeps the
    // earliest (richest) result; executedAt still updates so the claim clears.
    .set({
      executedAt: new Date(),
      result: sql`COALESCE(${pendingCommands.result}, ${JSON.stringify(result)}::jsonb)`,
    })
    .where(and(eq(pendingCommands.id, id), eq(pendingCommands.userId, userId)))
    .returning({ id: pendingCommands.id });
  return updated.length > 0;
}

// Returns commands the user should know about: executed-and-failed (ok=false)
// PLUS executed-but-unverified inject commands (ok=true, verified=false — the
// keystrokes landed but the agent didn't react within the post-flight window).
// Limited to the last 10 minutes so a long-running runner doesn't keep
// surfacing stale errors after the user has moved on.
export async function getRecentFailedCommands(userIds: string[]): Promise<FailedCommand[]> {
  if (userIds.length === 0) return [];
  const userFilter =
    userIds.length === 1
      ? eq(pendingCommands.userId, userIds[0])
      : inArray(pendingCommands.userId, userIds);
  const rows = await db
    .select({
      id: pendingCommands.id,
      type: pendingCommands.type,
      payload: pendingCommands.payload,
      result: pendingCommands.result,
      executedAt: pendingCommands.executedAt,
    })
    .from(pendingCommands)
    .where(
      and(
        userFilter,
        isNotNull(pendingCommands.executedAt),
        sql`((${pendingCommands.result}->>'ok') = 'false' OR ((${pendingCommands.result}->>'ok') = 'true' AND (${pendingCommands.result}->>'verified') = 'false'))`,
        sql`${pendingCommands.executedAt} > NOW() - INTERVAL '10 minutes'`,
      ),
    )
    .orderBy(desc(pendingCommands.executedAt))
    .limit(20);

  return rows
    .filter((r) => r.executedAt != null)
    .map((r) => {
      const result = (r.result ?? {}) as Record<string, unknown>;
      const isFailure = result.ok === false;
      const isUnverified = result.ok === true && result.verified === false;
      const error = isFailure
        ? ((result.error as string) ?? "command failed")
        : ((result.warning as string) ?? "delivered but agent did not pick up");
      return {
        id: r.id,
        tab: ((r.payload as Record<string, unknown>)?.tab as string) ?? "unknown",
        type: r.type,
        error,
        executedAt: r.executedAt!.toISOString(),
        ...(isUnverified ? { unverified: true as const } : {}),
      };
    });
}

/** Open pending commands keyed by payload.runId — feedback Watch / Queued truth. */
export type PendingByRun = {
  id: string;
  type: string;
  claimedAt: Date | null;
  executedAt: Date | null;
  createdAt: Date;
  /** payload.channel — which builder may claim this row. */
  channel: RunnerChannel | null;
};

export async function getOpenPendingByRunIds(
  userId: string,
  runIds: string[],
): Promise<Map<string, PendingByRun>> {
  if (runIds.length === 0) return new Map();
  const wanted = new Set(runIds);
  // Inbox pages pass a small runId list; filter in memory so we never fight
  // jsonb→text casting in SQL for a handful of rows.
  const rows = await db
    .select({
      id: pendingCommands.id,
      type: pendingCommands.type,
      claimedAt: pendingCommands.claimedAt,
      executedAt: pendingCommands.executedAt,
      createdAt: pendingCommands.createdAt,
      payload: pendingCommands.payload,
    })
    .from(pendingCommands)
    .where(and(eq(pendingCommands.userId, userId), isNull(pendingCommands.executedAt)))
    .orderBy(desc(pendingCommands.createdAt))
    .limit(200);
  const out = new Map<string, PendingByRun>();
  for (const r of rows) {
    const payload = r.payload as { runId?: string; channel?: string } | null;
    const runId = payload?.runId;
    if (!runId || !wanted.has(runId) || out.has(runId)) continue;
    const ch = payload?.channel;
    out.set(runId, {
      id: r.id,
      type: r.type,
      claimedAt: r.claimedAt,
      executedAt: r.executedAt,
      createdAt: r.createdAt,
      channel: ch === "cloud" || ch === "local" ? ch : null,
    });
  }
  return out;
}

/** Latest executed inject ack per run — verified/ok/warning for work-phase,
 *  plus WHERE that attempt actually ran. */
export type InjectAckByRun = {
  ok: boolean | null;
  verified: boolean | null;
  warning: string | null;
  /**
   * The channel this attempt was handed to, read off the executed command row.
   *
   * This is the immutable execution identity of the ATTEMPT. The open pending
   * row carries the same fact but is gone for most of a run's life (the runner
   * stamps executedAt on its inject-ack), and the fallback after that was the
   * project's CURRENT routing preference — a setting the operator can change
   * afterwards, which cannot prove where a historical run went.
   */
  channel: RunnerChannel | null;
};

export async function getInjectAcksByRunIds(
  userId: string,
  runIds: string[],
): Promise<Map<string, InjectAckByRun>> {
  if (runIds.length === 0) return new Map();
  const wanted = new Set(runIds);
  const rows = await db
    .select({
      executedAt: pendingCommands.executedAt,
      result: pendingCommands.result,
      payload: pendingCommands.payload,
    })
    .from(pendingCommands)
    .where(and(eq(pendingCommands.userId, userId), isNotNull(pendingCommands.executedAt)))
    .orderBy(desc(pendingCommands.executedAt))
    .limit(300);
  const out = new Map<string, InjectAckByRun>();
  for (const r of rows) {
    const payload = r.payload as { runId?: string; channel?: string } | null;
    const runId = payload?.runId;
    if (!runId || !wanted.has(runId) || out.has(runId)) continue;
    const result = (r.result ?? {}) as {
      ok?: boolean;
      verified?: boolean;
      warning?: string;
    };
    out.set(runId, {
      ok: typeof result.ok === "boolean" ? result.ok : null,
      verified: typeof result.verified === "boolean" ? result.verified : null,
      warning: typeof result.warning === "string" ? result.warning : null,
      // Same validation as the open-row reader above: the channel lives in the
      // jsonb payload, so an unrecognised value is not a channel.
      channel: payload.channel === "cloud" || payload.channel === "local" ? payload.channel : null,
    });
  }
  return out;
}
