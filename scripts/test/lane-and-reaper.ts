/**
 * The project lane and the reaper, against a real Postgres.
 *
 * WHY THIS NEEDS A DATABASE
 * -------------------------
 * The queue's decisions — which agent may start, which run is dead — live in
 * SQL (fifoEligibilitySql, isProjectBusy, cleanupStaleOrchestrationRuns). That
 * SQL has put two prompts into one agent session and silently dropped queued
 * work in production, and until this file no test executed any of it: every
 * other suite is database-free by design (see scripts/test-unit.ts).
 *
 * WHAT IT LOCKS DOWN (all from one pair of runs, 2026-09-17)
 * ------------------------------------------------------------------
 *   A  "Next Best Task" on loki   created 15:48:37, delivered 15:49:20
 *   B  a feedback fix on loki     created 16:01:16, queued behind A
 *
 * 1. The gate released A's lane at 16:48:37 — started_at + 60 min — while A
 *    was still open, and B's prompt was "injected to running claude (pty)" at
 *    16:48:53: typed into the session it was meant to wait for.
 * 2. B was reaped at 17:15, 26 minutes after its prompt reached an agent,
 *    because its 60-minute window had been counting since it was QUEUED.
 * 3. A's finished_at was backdated to 16:48:37 although its own heartbeat
 *    reported output at 16:48:14 and it was not reaped until 17:15.
 *
 * Each scenario gets its own user, because the claim query drains across all
 * of a user's projects and would otherwise answer for a neighbouring case.
 *
 * WHERE IT RUNS
 * -------------
 * Only against a database it was pointed at on purpose: TEST_DATABASE_URL, or
 * DATABASE_URL when CI=true (CI builds a fresh, migrated Postgres per run).
 * Anywhere else it SKIPS, loudly — a laptop's DATABASE_URL is a dev database
 * and this writes rows. In CI: `pnpm run test:db`, after the migrate step.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const target =
  process.env.TEST_DATABASE_URL ??
  (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
if (!target) {
  console.log(
    "lane-and-reaper: SKIP — needs TEST_DATABASE_URL (or CI=true with DATABASE_URL). " +
      "It writes rows, so it never borrows a dev database by default.",
  );
  process.exit(0);
}
process.env.DATABASE_URL = target;

async function main(): Promise<number> {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { cleanupStaleOrchestrationRuns, isProjectBusy, MAX_RUN_HOURS, STALE_RUN_MINUTES } =
    await import("@/db/queries/orchestration-runs");
  const { claimNextPendingCommand, findQueueBlockers } =
    await import("@/db/queries/pending-commands");

  let passed = 0;
  const failures: string[] = [];
  async function check(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failures.push(name);
      // Drizzle wraps a database error as "Failed query: <sql>"; the reason
      // Postgres gave is on `cause`, and it is the only useful line.
      const cause = (err as { cause?: { message?: string } }).cause?.message;
      console.log(`  ✗ ${name}\n      ${cause ?? (err as Error).message.split("\n")[0]}`);
    }
  }
  function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
  }

  // ── fixtures ────────────────────────────────────────────────────────────────
  const createdUsers: string[] = [];

  async function newUser(tag: string): Promise<string> {
    const rows = await db.execute<{ id: string }>(
      sql`INSERT INTO users (username) VALUES (${`lanetest-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}) RETURNING id`,
    );
    const id = rows[0]!.id;
    createdUsers.push(id);
    return id;
  }

  type RunSpec = {
    user: string;
    key: string;
    /** Minutes since the row was created (queued). */
    createdAgo: number;
    /** Minutes since the prompt reached an agent; omit for undelivered. */
    deliveredAgo?: number;
    /** Minutes since the runner last saw output from it. */
    lastOutputAgo?: number;
    /** The run's command: executed (an agent session owns the tab) or waiting. */
    command: "executed" | "waiting";
  };

  async function openRun(r: RunSpec): Promise<{ runId: string; commandId: string }> {
    const payload = sql`jsonb_strip_nulls(jsonb_build_object(
    'projectKey', ${r.key}::text,
    'deliveredAt', ${r.deliveredAgo === undefined ? sql`NULL::jsonb` : sql`to_jsonb(NOW() - make_interval(mins => ${r.deliveredAgo}))`},
    'lastProgressAt', ${r.lastOutputAgo === undefined ? sql`NULL::jsonb` : sql`to_jsonb(NOW() - make_interval(mins => ${r.lastOutputAgo}))`}
  ))`;
    const [run] = await db.execute<{ id: string }>(sql`
    INSERT INTO orchestration_runs (user_id, adapter, intent, state, project_key, project_path, started_at, payload)
    VALUES (${r.user}, 'claude', 'custom', 'waiting', ${r.key}, ${`/tmp/${r.key}`},
            NOW() - make_interval(mins => ${r.createdAgo}), ${payload})
    RETURNING id`);
    const executed = r.command === "executed";
    const [cmd] = await db.execute<{ id: string }>(sql`
    INSERT INTO pending_commands (user_id, type, payload, created_at, claimed_at, executed_at)
    VALUES (${r.user}, 'dispatch',
            jsonb_build_object('runId', ${run!.id}::text, 'projectKey', ${r.key}::text,
                               'tab', ${r.key}::text, 'dir', ${`/tmp/${r.key}`}::text,
                               'agent', 'claude', 'prompt', 'lane test'),
            NOW() - make_interval(mins => ${r.createdAgo}),
            ${executed ? sql`NOW() - make_interval(mins => ${r.deliveredAgo ?? r.createdAgo})` : sql`NULL::timestamptz`},
            ${executed ? sql`NOW() - make_interval(mins => ${r.deliveredAgo ?? r.createdAgo})` : sql`NULL::timestamptz`})
    RETURNING id`);
    return { runId: run!.id, commandId: cmd!.id };
  }

  async function runRow(id: string) {
    const [row] = await db.execute<{
      finished_at: string | null;
      outcome: string | null;
      finished_mins_ago: number | null;
    }>(sql`
    SELECT finished_at, outcome,
           EXTRACT(EPOCH FROM (NOW() - finished_at)) / 60 AS finished_mins_ago
      FROM orchestration_runs WHERE id = ${id}`);
    return row!;
  }

  // ── 1. the lane is held until the run CLOSES ───────────────────────────────
  await check(
    "an open run holds its lane past an hour — no second prompt into its session",
    async () => {
      const user = await newUser("held");
      const a = await openRun({
        user,
        key: "held",
        createdAgo: 70,
        deliveredAgo: 69,
        lastOutputAgo: 1,
        command: "executed",
      });
      const b = await openRun({ user, key: "held", createdAgo: 58, command: "waiting" });

      const claimed = await claimNextPendingCommand([user], ["dispatch"], "local");
      assert(
        claimed === null,
        `B was claimed while A (created 70 min ago) is still open — that types B's prompt into A's live session (claimed ${claimed?.id})`,
      );

      const blockers = await findQueueBlockers([b.runId]);
      assert(
        blockers.get(b.runId)?.runId === a.runId,
        "findQueueBlockers must name A as the run ahead of B",
      );

      assert(
        (await isProjectBusy(user, "held", { excludeRunId: b.runId })) === true,
        "isProjectBusy must agree with the gate: A still holds the lane",
      );
    },
  );

  // ── 2. queue time is not working life; waiting is not stale ────────────────
  await check(
    "a run is timed from delivery, and a run waiting its turn is never reaped",
    async () => {
      const user = await newUser("clock");
      // A: queued 90 min ago but delivered only 20 min ago — 20 min into its work.
      const a = await openRun({
        user,
        key: "clock",
        createdAgo: 90,
        deliveredAgo: 20,
        command: "executed",
      });
      // B: queued 80 min ago behind A, never delivered — it has not been allowed to start.
      const b = await openRun({ user, key: "clock", createdAgo: 80, command: "waiting" });

      await cleanupStaleOrchestrationRuns(user);

      const ra = await runRow(a.runId);
      const rb = await runRow(b.runId);
      assert(
        ra.finished_at === null,
        `A was reaped (${ra.outcome}) 20 min after delivery — its window was counted from when it was queued`,
      );
      assert(
        rb.finished_at === null,
        `B was reaped (${rb.outcome}) while waiting its turn — work it never got a chance to start`,
      );
    },
  );

  // ── 3. a dead run is still reaped, truthfully, and the lane then opens ──────
  await check(
    "a dead run is reaped with a truthful end, and the next run is then claimable",
    async () => {
      const user = await newUser("dead");
      // Delivered 85 min ago, last output 5 min ago, no live heartbeat: dead.
      const a = await openRun({
        user,
        key: "dead",
        createdAgo: 90,
        deliveredAgo: 85,
        lastOutputAgo: 5,
        command: "executed",
      });
      const b = await openRun({ user, key: "dead", createdAgo: 80, command: "waiting" });

      await cleanupStaleOrchestrationRuns(user);

      const ra = await runRow(a.runId);
      assert(
        ra.finished_at !== null,
        "a run 85 min past delivery with no heartbeat must be reaped",
      );
      // Truthful end: never before the last output the runner saw (5 min ago),
      // never after now. The old stamp (created + 60 min) said 30 min ago.
      const endAgo = Number(ra.finished_mins_ago);
      assert(
        endAgo >= 0 && endAgo <= 5.5,
        `finished_at is ${endAgo.toFixed(1)} min ago; it must not predate the run's last output (5 min ago)`,
      );
      assert(
        (await runRow(b.runId)).finished_at === null,
        "B was waiting when A was reaped — it must survive that tick",
      );

      const claimed = await claimNextPendingCommand([user], ["dispatch"], "local");
      assert(
        claimed?.id === b.commandId,
        "once A is closed, B is the oldest and must be claimable",
      );
    },
  );

  // ── 4. a wedged holder cannot block a project forever ──────────────────────
  await check(
    `a holder past MAX_RUN_HOURS (${MAX_RUN_HOURS}h) stops blocking the lane`,
    async () => {
      const user = await newUser("wedged");
      await openRun({
        user,
        key: "wedged",
        createdAgo: (MAX_RUN_HOURS + 2) * 60,
        deliveredAgo: (MAX_RUN_HOURS + 1) * 60,
        command: "executed",
      });
      const b = await openRun({
        user,
        key: "wedged",
        createdAgo: STALE_RUN_MINUTES - 5,
        command: "waiting",
      });

      const claimed = await claimNextPendingCommand([user], ["dispatch"], "local");
      assert(
        claimed?.id === b.commandId,
        "a holder older than the reaper's own ceiling must not wedge the project",
      );
    },
  );

  // ── 5. one definition, by construction ─────────────────────────────────────
  await check("the lane rule and its clock are defined once", async () => {
    const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../src");
    const files: string[] = [];
    (function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") || p.endsWith(".tsx")) files.push(p);
      }
    })(root);
    const code = (p: string) =>
      readFileSync(p, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    const defs = files.filter((p) => /function olderOpenRunSql\b/.test(code(p)));
    assert(
      defs.length === 1,
      `olderOpenRunSql must be defined exactly once (found ${defs.length})`,
    );
    // The shape of the old duplicated timer: an open-run floor measured from
    // started_at against the reaper's STALENESS window instead of its ceiling.
    const oldFloor = files.filter((p) =>
      /started_at\s*>\s*NOW\(\)\s*-\s*INTERVAL '1 minute' \* \$\{STALE_RUN_MINUTES\}/.test(code(p)),
    );
    assert(
      oldFloor.length === 0,
      `a lane floor on STALE_RUN_MINUTES is back in: ${oldFloor.join(", ")}`,
    );
  });

  // ── cleanup ────────────────────────────────────────────────────────────────
  // The reaper fires notifications and ledger updates as fire-and-forget
  // promises; give them a moment before deleting what they reference.
  await new Promise((r) => setTimeout(r, 1500));
  for (const user of createdUsers) {
    await db.execute(sql`DELETE FROM run_events WHERE user_id = ${user}`).catch(() => undefined);
    await db
      .execute(sql`DELETE FROM run_escalations WHERE user_id = ${user}`)
      .catch(() => undefined);
    await db.execute(sql`DELETE FROM pending_commands WHERE user_id = ${user}`);
    await db.execute(sql`DELETE FROM orchestration_runs WHERE user_id = ${user}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${user}`).catch(() => undefined);
  }

  console.log(`\nlane-and-reaper: ${passed} passed, ${failures.length} failed`);
  return failures.length ? 1 : 0;
}

void main().then((code) => process.exit(code));
