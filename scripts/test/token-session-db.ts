/**
 * A token-session link opens once, before it expires, while its token lives;
 * and the session it opened reads as signed out once the token is gone
 * (src/lib/auth/token-session.ts), against a real Postgres.
 *
 * Same rules as lane-and-reaper: TEST_DATABASE_URL, or DATABASE_URL in CI.
 */
const target =
  process.env.TEST_DATABASE_URL ??
  (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
if (!target) {
  console.log(
    "token-session-db: SKIP — needs TEST_DATABASE_URL (or CI=true with DATABASE_URL). " +
      "It writes rows, so it never borrows a dev database by default.",
  );
  process.exit(0);
}
process.env.DATABASE_URL = target;

async function main(): Promise<number> {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { createAgentToken, deleteAgentToken } = await import("@/db/queries/agent-tokens");
  const q = await import("@/db/queries/token-sessions");

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
  const rows = await db.execute<{ id: string }>(
    sql`INSERT INTO users (username) VALUES (${`tokensession-${stamp}`}) RETURNING id`,
  );
  const user = rows[0]!.id;
  const { token, record } = await createAgentToken(user, "qa seat");
  const mint = (ttlSeconds = 120) =>
    q.mintTokenSessionLink({
      userId: user,
      agentTokenId: record.id,
      nextPath: "/projects",
      ttlSeconds,
    });

  await check("a live token is found, an unknown one is not", async () => {
    assert((await q.findLiveAgentToken(token))?.userId === user, "the token was not found");
    assert(
      (await q.findLiveAgentToken(`ck_${"0".repeat(64)}`)) === null,
      "a made-up token was found",
    );
  });

  await check("the code is kept as a hash, never in plain", async () => {
    const { code } = await mint();
    const stored = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM token_sessions WHERE code_hash = ${code}`,
    );
    assert(stored[0]!.n === 0, "the plaintext code is stored");
  });

  await check("a link opens once", async () => {
    const { code } = await mint();
    const first = await q.consumeTokenSessionLink(code);
    assert(first?.userId === user && first.nextPath === "/projects", "the link did not open");
    assert((await q.consumeTokenSessionLink(code)) === null, "the link opened twice");
  });

  await check("an expired link does not open", async () => {
    const { code } = await mint(-1);
    assert((await q.consumeTokenSessionLink(code)) === null, "an expired link opened");
  });

  await check("an unknown code does not open", async () => {
    assert((await q.consumeTokenSessionLink("nope")) === null, "an unknown code opened");
    assert((await q.consumeTokenSessionLink("")) === null, "an empty code opened");
  });

  await check("a session is the token's while the token lives, then signed out", async () => {
    const { code } = await mint();
    const link = await q.consumeTokenSessionLink(code);
    assert(link, "the link did not open");
    const sessionId = `sess-${stamp}`;
    await q.bindTokenSession(link.id, sessionId);
    assert(
      (await q.tokenSessionState(sessionId))?.live === true,
      "a live token's session is not live",
    );
    assert(
      (await q.tokenSessionState(`other-${stamp}`)) === null,
      "a person's session reads as a token's",
    );

    const pending = await mint();
    await deleteAgentToken(record.id, user);
    assert(
      (await q.tokenSessionState(sessionId))?.live === false,
      "a revoked token's session lives on",
    );
    assert(
      (await q.consumeTokenSessionLink(pending.code)) === null,
      "a link minted before the token was revoked still opens",
    );
  });

  await check("an expired token's link does not open", async () => {
    const other = await createAgentToken(user, "qa seat 2");
    const { code } = await q.mintTokenSessionLink({
      userId: user,
      agentTokenId: other.record.id,
      nextPath: "/",
      ttlSeconds: 120,
    });
    await db.execute(
      sql`UPDATE agent_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = ${other.record.id}`,
    );
    assert((await q.consumeTokenSessionLink(code)) === null, "an expired token's link opened");
  });

  await db.execute(sql`DELETE FROM token_sessions WHERE user_id = ${user}`).catch(() => undefined);
  await db.execute(sql`DELETE FROM agent_tokens WHERE user_id = ${user}`).catch(() => undefined);
  await db.execute(sql`DELETE FROM users WHERE id = ${user}`).catch(() => undefined);

  console.log(`\ntoken-session-db: ${passed} passed, ${failures.length} failed`);
  return failures.length ? 1 : 0;
}

void main().then((code) => process.exit(code));
