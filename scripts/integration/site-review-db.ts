/** Disposable-Postgres integration check. Never points at DATABASE_URL. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  assert(
    url && new URL(url).pathname.endsWith("_test"),
    "Use an explicitly named *_test database in TEST_DATABASE_URL",
  );
  process.env.DATABASE_URL = url;
  const sql = postgres(url, { max: 1 });
  await sql`create table if not exists users (id uuid primary key)`;
  await sql`create table if not exists entities (id uuid primary key)`;
  await sql.unsafe(await readFile("drizzle/0103_site_reviews.sql", "utf8"));
  const { db } = await import("../../src/db");
  const { siteReviews } = await import("../../src/db/schema/site-reviews");
  const {
    getSiteReview,
    getWorkerReview,
    reviewTokenHash,
    reviewEvents,
    addReviewEvent,
    publicReview,
    publicReviewEvents,
    updateSiteReview,
  } = await import("../../src/db/queries/site-reviews");
  const { handleReviewWorker } = await import("../../src/lib/inspection/worker-handler");
  const userId = randomUUID(),
    other = randomUUID(),
    projectId = randomUUID();
  await sql`insert into users values (${userId}), (${other})`;
  await sql`insert into entities values (${projectId})`;
  const [row] = await db
    .insert(siteReviews)
    .values({
      userId,
      projectId,
      mode: "functional",
      url: "https://review.orangecat.ch",
      tokenHash: reviewTokenHash("ticket"),
    })
    .returning();
  assert.equal(await getSiteReview(other, row.id), null, "Cross-tenant read refused");
  assert.equal(await getWorkerReview(row.id, "wrong"), null);
  assert.equal((await getWorkerReview(row.id, "ticket"))?.id, row.id);
  assert(!("tokenHash" in publicReview(row)));
  assert(!("workerId" in publicReview(row)));
  const duplicate = await db
    .insert(siteReviews)
    .values({ userId, projectId, mode: "code", url: "", tokenHash: "other" })
    .onConflictDoNothing()
    .returning();
  assert.equal(duplicate.length, 0, "At most one active inspection per project");
  const workerId = randomUUID();
  const running = await handleReviewWorker(row, { kind: "checkpoint", workerId });
  assert(running);
  assert.equal(running.status, "running");
  assert.equal(
    await handleReviewWorker(running, { kind: "checkpoint", workerId: randomUUID() }),
    null,
    "Second worker cannot claim",
  );
  const frame = {
    url: row.url,
    image: "data:image/jpeg;base64,aGVsbG8=",
    width: 390,
    height: 760,
    scrollY: 0,
    action: "Open page",
  };
  await updateSiteReview(running, { status: "paused" });
  assert.equal(
    await handleReviewWorker(running, {
      kind: "frame",
      frame,
      text: "Late screenshot",
      analyze: false,
    }),
    null,
    "Pause wins over a late frame",
  );
  assert.equal(
    await handleReviewWorker(running, { kind: "finished", text: "Late finish" }),
    null,
    "Pause cannot be overwritten by a stale completion",
  );
  assert(
    !(await reviewEvents(userId, row.id)).some((event) => event.text === "Late finish"),
    "Rejected completion must not claim success in the discussion",
  );
  const paused = await getSiteReview(userId, row.id);
  assert(paused);
  const ack = await handleReviewWorker(paused, { kind: "checkpoint", workerId });
  assert.equal(ack?.workerState, "paused");
  const resumed = await updateSiteReview(paused, { status: "running" });
  await handleReviewWorker(resumed, { kind: "frame", frame, text: "Open page", analyze: false });
  const saved = await getSiteReview(userId, row.id);
  assert(saved?.frame);
  assert.match(publicReview(saved).frame!.image, /^\/api\/reviews\/.*\/frame\?key=/);
  for (let i = 0; i < 25; i++)
    await addReviewEvent(saved, {
      kind: "finding",
      text: `Issue ${i}`,
      finding: {
        title: `Issue ${i}`,
        detail: "Recorded detail",
        evidence: "Observed",
        location: "/",
        category: "functional",
      },
      image: frame.image,
    });
  const events = await reviewEvents(userId, row.id);
  assert.equal(
    events.filter((e) => e.kind === "finding").length,
    24,
    "Finding budget is enforced atomically",
  );
  assert(
    publicReviewEvents(events)
      .filter((e) => e.image)
      .every((e) => e.image?.startsWith(`/api/reviews/${row.id}/frame?event=`)),
  );
  assert.deepEqual(await reviewEvents(other, row.id), []);
  console.log(
    "Site review DB: tenant isolation, scoped tickets, exclusive worker, active uniqueness, pause races, private evidence and finding cap passed",
  );
  await sql.end();
  // drizzle's pooled connection is process-global; this script is a one-shot check.
  process.exit(0);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
