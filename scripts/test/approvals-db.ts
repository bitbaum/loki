/**
 * Permission prompts against a real Postgres (src/db/queries/approvals.ts):
 * surfaced for the owner, answered by a person and by a token with the answer
 * recorded, refused for another account, for a question the agent has moved
 * past, and for a second answer racing the first.
 *
 * Same rules as lane-and-reaper: TEST_DATABASE_URL, or DATABASE_URL in CI.
 */
const target =
  process.env.TEST_DATABASE_URL ??
  (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
if (!target) {
  console.log(
    "approvals-db: SKIP — needs TEST_DATABASE_URL (or CI=true with DATABASE_URL). " +
      "It writes rows, so it never borrows a dev database by default.",
  );
  process.exit(0);
}
process.env.DATABASE_URL = target;

async function main(): Promise<number> {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { listPendingApprovals, answerApproval } = await import("@/db/queries/approvals");

  let passed = 0;
  const failures: string[] = [];
  async function check(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failures.push(name);
      const cause = (err as { cause?: { message?: string } }).cause?.message;
      console.log(`  ✗ ${name}\n      ${cause ?? (err as Error).message.split("\n")[0]}`);
    }
  }
  function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
  }

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const users: string[] = [];
  async function newUser(tag: string) {
    const rows = await db.execute<{ id: string }>(
      sql`INSERT INTO users (username) VALUES (${`approvals-${tag}-${stamp}`}) RETURNING id`,
    );
    users.push(rows[0]!.id);
    return rows[0]!.id;
  }
  async function blockedRun(user: string, key: string, question: string, adapter = "claude") {
    const [run] = await db.execute<{ id: string }>(sql`
      INSERT INTO orchestration_runs (user_id, adapter, intent, state, project_key, project_path, payload)
      VALUES (${user}, ${adapter}, 'custom', 'running', ${key}, ${`/tmp/${key}`},
              jsonb_build_object('blocked', 'permission', 'blockedQuestion', ${question}::text,
                                 'blockedAt', to_jsonb(NOW() - INTERVAL '6 minutes')))
      RETURNING id`);
    await db.execute(sql`
      INSERT INTO pending_commands (user_id, type, payload, created_at, claimed_at, executed_at)
      VALUES (${user}, 'dispatch', jsonb_build_object('runId', ${run!.id}::text, 'projectKey', ${key}::text,
              'tab', ${key}::text, 'channel', 'cloud', 'agent', ${adapter}::text, 'prompt', 'x'),
              NOW(), NOW(), NOW())`);
    return run!.id;
  }
  const payloadOf = async (runId: string) =>
    (
      await db.execute<{ payload: Record<string, unknown> }>(
        sql`SELECT payload FROM orchestration_runs WHERE id = ${runId}`,
      )
    )[0]!.payload;

  const owner = await newUser("owner");
  const stranger = await newUser("stranger");
  const key = `oc-${stamp}`;
  const runId = await blockedRun(owner, key, "Allow Update Environment?");

  await check("surface: the owner's prompt is listed, with the wait and the answers", async () => {
    const [a] = await listPendingApprovals(owner, key);
    assert(a && a.runId === runId, "not listed");
    assert(a.tab === key && a.kind === "environment", `wrong tab/kind ${a.tab}/${a.kind}`);
    assert(/waiting for 6 minutes/.test(a.headline), a.headline);
    assert(a.choices.includes("allow_always"), "choices missing");
  });

  await check("deny: another account sees none and cannot answer", async () => {
    assert((await listPendingApprovals(stranger, null)).length === 0, "a stranger sees it");
    const [a] = await listPendingApprovals(owner, key);
    const r = await answerApproval({
      userId: stranger,
      approvalId: a!.id,
      decision: "allow_once",
      answeredBy: { userId: stranger, via: "token" },
    });
    assert(!r.ok && r.status === 404, "a stranger answered");
    assert((await payloadOf(runId)).blocked === "permission", "the stranger cleared it");
  });

  await check("deny: an answer to a question the agent has moved past", async () => {
    const stale = await answerApproval({
      userId: owner,
      approvalId: `${runId}.00000000`,
      decision: "allow_once",
      answeredBy: { userId: owner, via: "session" },
    });
    assert(!stale.ok && stale.status === 409, `stale answer ${JSON.stringify(stale)}`);
  });

  await check("answer by operator: keys sent, block cleared, answer recorded", async () => {
    const [a] = await listPendingApprovals(owner, key);
    const r = await answerApproval({
      userId: owner,
      approvalId: a!.id,
      decision: "allow_once",
      tab: key,
      answeredBy: { userId: owner, via: "session" },
    });
    assert(r.ok, `refused: ${JSON.stringify(r)}`);
    const p = await payloadOf(runId);
    assert(p.blocked === null, "still blocked");
    const last = p.lastApproval as { decision: string; by: string; via: string; at: string };
    assert(
      last.decision === "allow_once" && last.by === owner && last.via === "session",
      "no audit",
    );
    const ev = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM run_events WHERE run_id = ${runId} AND kind = 'approval'`,
    );
    // emitRunEvent is fire-and-forget; give it a moment.
    if (ev[0]!.n === 0) await new Promise((r) => setTimeout(r, 500));
    const ev2 = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM run_events WHERE run_id = ${runId} AND kind = 'approval'`,
    );
    assert(ev2[0]!.n === 1, "no run event");
  });

  await check("a second answer finds nothing waiting", async () => {
    const r = await answerApproval({
      userId: owner,
      approvalId: `${runId}.00000000`,
      decision: "deny",
      answeredBy: { userId: owner, via: "session" },
    });
    assert(!r.ok && r.status === 404, "answered twice");
  });

  await check("answer by token: recorded as the token", async () => {
    const id2 = await blockedRun(owner, `${key}-b`, "Do you want to proceed?");
    const [a] = await listPendingApprovals(owner, `${key}-b`);
    const r = await answerApproval({
      userId: owner,
      approvalId: a!.id,
      decision: "deny",
      answeredBy: { userId: owner, via: "token" },
    });
    assert(r.ok, "refused");
    const last = (await payloadOf(id2)).lastApproval as { via: string; decision: string };
    assert(last.via === "token" && last.decision === "deny", "not recorded as the token");
  });

  await check("an agent with no known keys is refused, nothing typed", async () => {
    const id3 = await blockedRun(owner, `${key}-c`, "Allow command?", "codex");
    const [a] = await listPendingApprovals(owner, `${key}-c`);
    const r = await answerApproval({
      userId: owner,
      approvalId: a!.id,
      decision: "allow_once",
      answeredBy: { userId: owner, via: "session" },
    });
    assert(!r.ok && r.status === 422, "guessed a key");
    assert((await payloadOf(id3)).blocked === "permission", "cleared without typing");
  });

  await new Promise((r) => setTimeout(r, 500));
  for (const u of users) {
    await db.execute(sql`DELETE FROM run_events WHERE user_id = ${u}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM pending_commands WHERE user_id = ${u}`).catch(() => undefined);
    await db
      .execute(sql`DELETE FROM orchestration_runs WHERE user_id = ${u}`)
      .catch(() => undefined);
    await db.execute(sql`DELETE FROM users WHERE id = ${u}`).catch(() => undefined);
  }
  console.log(`\napprovals-db: ${passed} passed, ${failures.length} failed`);
  return failures.length ? 1 : 0;
}

void main().then((code) => process.exit(code));
