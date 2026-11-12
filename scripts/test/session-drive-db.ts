/**
 * The drive grant against a real Postgres (src/lib/session-drive.ts): a seat
 * reaches the one project session its owner granted, never the owner's other
 * projects, and a revoked grant reaches nothing.
 *
 * Same rules as lane-and-reaper: TEST_DATABASE_URL, or DATABASE_URL in CI.
 */
const target =
  process.env.TEST_DATABASE_URL ??
  (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
if (!target) {
  console.log(
    "session-drive-db: SKIP — needs TEST_DATABASE_URL (or CI=true with DATABASE_URL). " +
      "It writes rows, so it never borrows a dev database by default.",
  );
  process.exit(0);
}
process.env.DATABASE_URL = target;

async function main(): Promise<number> {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { listDriveGrants, resolveDriveTarget } = await import("@/db/queries/session-drive");
  const { setMemberDrivesSession } = await import("@/db/queries/project-access");

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
      sql`INSERT INTO users (username) VALUES (${`drive-${tag}-${stamp}`}) RETURNING id`,
    );
    users.push(rows[0]!.id);
    return rows[0]!.id;
  }
  async function newProject(owner: string, name: string) {
    const rows = await db.execute<{ id: string }>(
      sql`INSERT INTO entities (user_id, name, type) VALUES (${owner}, ${name}, 'project') RETURNING id`,
    );
    await db.execute(
      sql`INSERT INTO user_projects (user_id, name, entity_project_id) VALUES (${owner}, ${name}, ${rows[0]!.id})`,
    );
    return rows[0]!.id;
  }

  const owner = await newUser("owner");
  const seat = await newUser("seat");
  const walkName = `qa-agent-walk-${stamp}`;
  const otherName = `orangecat-${stamp}`;
  const walk = await newProject(owner, walkName);
  const other = await newProject(owner, otherName);
  await db.execute(
    sql`INSERT INTO project_memberships (project_id, user_id, role) VALUES (${walk}, ${seat}, 'viewer'), (${other}, ${seat}, 'viewer')`,
  );

  await check("a membership grants nothing until the owner says so", async () => {
    assert((await listDriveGrants(seat)).length === 0, "a plain membership drives a session");
    const t = await resolveDriveTarget(seat, walkName);
    assert(t.kind === "own" && t.ownerId === seat, "a plain member reached the owner's session");
  });

  await check("allow: the granted project's own session, as its owner", async () => {
    assert(await setMemberDrivesSession(walk, seat, true), "the grant did not save");
    const t = await resolveDriveTarget(seat, walkName.toUpperCase());
    assert(t.kind === "granted", "the grant was not honoured");
    assert(t.ownerId === owner && t.tab === walkName, "the wrong session");
  });

  await check("deny: the owner's other project, though the seat is a member", async () => {
    const t = await resolveDriveTarget(seat, otherName);
    assert(t.kind === "own" && t.ownerId === seat, "a seat reached an ungranted project's session");
  });

  await check("deny: a stranger, and a revoked grant", async () => {
    const stranger = await newUser("stranger");
    assert(
      (await resolveDriveTarget(stranger, walkName)).ownerId === stranger,
      "a stranger got in",
    );
    assert(await setMemberDrivesSession(walk, seat, false), "the revoke did not save");
    assert(
      (await resolveDriveTarget(seat, walkName)).ownerId === seat,
      "a revoked grant still drives",
    );
    assert(!(await setMemberDrivesSession(walk, stranger, true)), "a non-member was granted");
  });

  for (const u of users) {
    await db
      .execute(sql`DELETE FROM project_memberships WHERE user_id = ${u}`)
      .catch(() => undefined);
    await db.execute(sql`DELETE FROM user_projects WHERE user_id = ${u}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM entities WHERE user_id = ${u}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM users WHERE id = ${u}`).catch(() => undefined);
  }
  console.log(`\nsession-drive-db: ${passed} passed, ${failures.length} failed`);
  return failures.length ? 1 : 0;
}

void main().then((code) => process.exit(code));
