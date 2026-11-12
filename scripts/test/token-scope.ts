/**
 * A `ck_` token answers for its own user and nobody else, against a real
 * Postgres.
 *
 * The token routes (scripts/test/token-session-routes.ts) resolve a caller to
 * a user id and then read through the same queries a browser does. What keeps
 * a Viewer seat's token inside its projects is therefore the data path, and
 * this proves it on the rows themselves:
 *
 *   allow  the seat's token resolves to the seat; the project shared to it
 *          reads, read-only (a viewer cannot edit); an editor's reads editable.
 *   deny   the owner's other project does not read for the seat; the owner's
 *          own rows are not the seat's (/api/user-projects); a revoked or
 *          expired token resolves to nobody.
 *
 * Same rules as lane-and-reaper: TEST_DATABASE_URL, or DATABASE_URL in CI.
 */
const target =
  process.env.TEST_DATABASE_URL ??
  (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
if (!target) {
  console.log(
    "token-scope: SKIP — needs TEST_DATABASE_URL (or CI=true with DATABASE_URL). " +
      "It writes rows, so it never borrows a dev database by default.",
  );
  process.exit(0);
}
process.env.DATABASE_URL = target;

async function main(): Promise<number> {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { createAgentToken, validateAgentToken, deleteAgentToken } =
    await import("@/db/queries/agent-tokens");
  const { resolveProjectDetailWithOrgFallback } = await import("@/db/queries/projects");
  const { getUserProjects } = await import("@/db/queries/user-projects");

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

  const createdUsers: string[] = [];
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  async function newUser(tag: string): Promise<string> {
    const rows = await db.execute<{ id: string }>(
      sql`INSERT INTO users (username) VALUES (${`tokenscope-${tag}-${stamp}`}) RETURNING id`,
    );
    createdUsers.push(rows[0]!.id);
    return rows[0]!.id;
  }
  async function newProject(owner: string, name: string): Promise<string> {
    const rows = await db.execute<{ id: string }>(
      sql`INSERT INTO entities (user_id, name, type) VALUES (${owner}, ${`${name}-${stamp}`}, 'project') RETURNING id`,
    );
    await db.execute(
      sql`INSERT INTO user_projects (user_id, name, entity_project_id) VALUES (${owner}, ${`${name}-${stamp}`}, ${rows[0]!.id})`,
    );
    return rows[0]!.id;
  }
  async function share(project: string, user: string, role: "viewer" | "editor") {
    await db.execute(
      sql`INSERT INTO project_memberships (project_id, user_id, role) VALUES (${project}, ${user}, ${role})`,
    );
  }

  const owner = await newUser("owner");
  const seat = await newUser("seat");
  const editor = await newUser("editor");
  const walk = await newProject(owner, "qa-agent-walk");
  const other = await newProject(owner, "orangecat");
  await share(walk, seat, "viewer");
  await share(walk, editor, "editor");
  const { token, record } = await createAgentToken(seat, "qa seat");

  await check("allow: the seat's token resolves to the seat", async () => {
    const who = await validateAgentToken(token);
    assert(who?.userId === seat, `resolved to ${who?.userId ?? "nobody"}`);
  });

  await check("allow: the shared project reads for the seat, read-only", async () => {
    const r = await resolveProjectDetailWithOrgFallback(seat, walk);
    assert(r, "the seat's own project did not read");
    assert(r.ownerId === owner, "read under the wrong owner");
    assert(r.canEdit === false, "a viewer can edit");
  });

  await check("allow: an editor's membership reads editable", async () => {
    const r = await resolveProjectDetailWithOrgFallback(editor, walk);
    assert(r?.canEdit === true, "an editor cannot edit");
  });

  await check("deny: the owner's other project does not read for the seat", async () => {
    const r = await resolveProjectDetailWithOrgFallback(seat, other);
    assert(r === null, "a project never shared to the seat read for it");
  });

  await check("deny: the owner's rows are not the seat's (/api/user-projects)", async () => {
    const rows = await getUserProjects(seat);
    assert(rows.length === 0, `the seat listed ${rows.length} of the owner's rows`);
    const own = await getUserProjects(owner);
    assert(own.length === 2, "the owner's own list is wrong");
  });

  await check("deny: an expired token resolves to nobody", async () => {
    const expired = await createAgentToken(seat, "qa seat expired");
    await db.execute(
      sql`UPDATE agent_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = ${expired.record.id}`,
    );
    assert((await validateAgentToken(expired.token)) === null, "an expired token still resolves");
  });

  await check("deny: a revoked token resolves to nobody", async () => {
    await deleteAgentToken(record.id, seat);
    assert((await validateAgentToken(token)) === null, "a revoked token still resolves");
  });

  for (const user of createdUsers) {
    await db.execute(sql`DELETE FROM agent_tokens WHERE user_id = ${user}`).catch(() => undefined);
    await db
      .execute(sql`DELETE FROM project_memberships WHERE user_id = ${user}`)
      .catch(() => undefined);
    await db.execute(sql`DELETE FROM user_projects WHERE user_id = ${user}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM entities WHERE user_id = ${user}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM users WHERE id = ${user}`).catch(() => undefined);
  }

  console.log(`\ntoken-scope: ${passed} passed, ${failures.length} failed`);
  return failures.length ? 1 : 0;
}

void main().then((code) => process.exit(code));
