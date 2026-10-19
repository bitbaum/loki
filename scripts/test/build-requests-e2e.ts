/**
 * Build requests (config/build-requests), against the migrated CI/scratch
 * database: a new account's "Make it real" is filed once however often it is
 * sent, is visible only to the account that filed it, is decided exactly
 * once, goes back to waiting when its build cannot start, and the preview it
 * becomes opens with a code of its own — never the operator's.
 *
 * Creates only UUID-scoped test users and removes them in finally.
 * Run: DATABASE_URL=… npx tsx scripts/test/build-requests-e2e.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";

async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL must be a migrated scratch/CI database");
  // No preview folder on this server: an approval cannot start a build.
  delete process.env.LOKI_PREVIEWS_ROOT;
  delete process.env.LOKI_BOX_DEV_ROOT;
  const { db } = await import("../../src/db");
  const { users, entities, buildRequests, userPreferences } = await import("../../src/db/schema");
  const q = await import("../../src/db/queries/build-requests");
  const { getProjectPreviewCode, setProjectPreviewCode, setPreviewCode } =
    await import("../../src/db/queries/preview-code");
  const { decideBuildRequest } = await import("../../src/lib/build-requests/decide");

  const [visitor, stranger, operator] = [randomUUID(), randomUUID(), randomUUID()];
  const people = [visitor, stranger, operator];
  const brief = (requestId: string) => ({
    website: "https://example.ch/",
    changes: "Make the headline warmer",
    mode: "refresh",
    requestId,
    fixes: [],
    answers: [],
  });
  try {
    await db.insert(users).values(people.map((id) => ({ id, name: "build-request test" })));

    // Filed once, however often it is sent.
    const requestId = randomUUID();
    const first = await q.fileBuildRequest({
      userId: visitor,
      requestId,
      website: "https://example.ch/",
      brief: brief(requestId),
      look: {
        before: "data:image/jpeg;base64,AA",
        after: "data:image/jpeg;base64,AB",
        summary: "x",
      },
    });
    const again = await q.fileBuildRequest({
      userId: visitor,
      requestId,
      website: "https://example.ch/",
      brief: brief(requestId),
      look: null,
    });
    assert.equal(first.fresh, true);
    assert.equal(again.fresh, false, "a repeat is not a second request");
    assert.equal(again.row.id, first.row.id);
    assert.equal(first.row.status, "waiting");

    // Theirs only.
    assert.ok(await q.getOwnBuildRequest(visitor, first.row.id));
    assert.equal(await q.getOwnBuildRequest(stranger, first.row.id), null, "not someone else's");

    // An approval whose build cannot start goes back to waiting, with the reason.
    const blocked = await decideBuildRequest(operator, first.row.id, { decision: "approve" });
    assert.equal(blocked.ok, false);
    assert.equal(!blocked.ok && blocked.status, 503);
    assert.equal((await q.getBuildRequest(first.row.id))?.status, "waiting", "nothing is lost");

    // Decided exactly once: the first claim wins, a second and a racing decline do not.
    const claimed = await q.claimBuildRequest(first.row.id, "building", null);
    assert.equal(claimed?.status, "building");
    assert.equal(await q.claimBuildRequest(first.row.id, "building", null), null);
    assert.equal(await q.claimBuildRequest(first.row.id, "declined", "no"), null);
    await q.reopenBuildRequest(first.row.id);

    // Declined with a note the visitor reads.
    const declined = await decideBuildRequest(operator, first.row.id, {
      decision: "decline",
      note: "Not this week",
    });
    assert.ok(declined.ok && declined.row.status === "declined");
    assert.equal((await q.getBuildRequest(first.row.id))?.note, "Not this week");
    const repeat = await decideBuildRequest(operator, first.row.id, { decision: "approve" });
    assert.equal(!repeat.ok && repeat.status, 409, "a decided request stays decided");

    // Waiting ones come first for the operator.
    const second = await q.fileBuildRequest({
      userId: visitor,
      requestId: randomUUID(),
      website: "https://example.org/",
      brief: brief(randomUUID()),
      look: null,
    });
    const listed = (await q.listBuildRequests()).filter((r) => r.userId === visitor);
    assert.equal(listed[0]?.id, second.row.id, "waiting before decided");

    // A preview's own code wins over its owner's — the one a visitor is given.
    await setPreviewCode(operator, "operatorcode");
    const [project] = await db
      .insert(entities)
      .values({ userId: operator, name: "build-request-test", type: "project" })
      .returning();
    const ref = { userId: operator, entityProjectId: project!.id };
    assert.equal(await getProjectPreviewCode(ref), "operatorcode", "owner's code by default");
    await setProjectPreviewCode(project!.id, "ownone");
    assert.equal(await getProjectPreviewCode(ref), "ownone", "the preview's own code wins");
    assert.equal(
      await getProjectPreviewCode({ userId: operator, entityProjectId: null }),
      "operatorcode",
    );

    console.log("build-requests-e2e: all checks passed");
  } finally {
    await db.delete(buildRequests).where(inArray(buildRequests.userId, people));
    await db.delete(entities).where(inArray(entities.userId, people));
    await db.delete(userPreferences).where(inArray(userPreferences.userId, people));
    await db.delete(users).where(inArray(users.id, people));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
