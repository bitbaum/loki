/** A disposable database proves notes persist separately and require explicit promotion. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { getTableConfig } from "drizzle-orm/pg-core";

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  assert(url && new URL(url).pathname.endsWith("_test"), "Use an explicit *_test database");
  process.env.DATABASE_URL = url;
  const sql = postgres(url, { max: 1 });
  const { siteFeedback } = await import("../../src/db/schema/site-feedback");
  // Build the pre-migration shape in an otherwise empty disposable database.
  const columns = getTableConfig(siteFeedback).columns.filter(
    (column) => !["requires_review", "capture_context"].includes(column.name),
  );
  await sql.unsafe(
    `create table site_feedback (${columns
      .map((column) => `"${column.name}" ${column.getSQLType()}`)
      .join(",")})`,
  );
  await sql.unsafe(await readFile("drizzle/0104_feedback_review_notes.sql", "utf8"));
  const { insertSiteFeedback, setFeedbackStatus, markFeedbackDispatchedBulk } =
    await import("../../src/db/queries/site-feedback");
  const { FEEDBACK_STATUS } = await import("../../src/lib/constants/statuses");
  const userId = randomUUID();
  const context = { "Screen when speaking": "390×844; scroll 0,900" };
  const insert = () =>
    insertSiteFeedback({
      id: randomUUID(),
      userId,
      projectId: randomUUID(),
      suggestion: "Make this clearer",
      status: FEEDBACK_STATUS.NEW,
      requiresReview: true,
      captureContext: context,
    });
  const note = await insert();
  assert(note?.requiresReview);
  assert.deepEqual(note.captureContext, context);
  assert.equal(await setFeedbackStatus(randomUUID(), note.id, FEEDBACK_STATUS.DISPATCHED), null);
  const archived = await setFeedbackStatus(userId, note.id, FEEDBACK_STATUS.ARCHIVED);
  assert(archived?.requiresReview, "Archiving does not grant permission to build");
  const reopened = await setFeedbackStatus(userId, note.id, FEEDBACK_STATUS.NEW);
  assert(reopened?.requiresReview, "Reopening keeps an observation held");
  const fixed = await setFeedbackStatus(userId, note.id, FEEDBACK_STATUS.DISPATCHED, randomUUID());
  assert.equal(fixed?.requiresReview, false, "Explicit dispatch promotes the note");
  assert.deepEqual(fixed?.captureContext, context, "Promotion retains original evidence");
  const second = await insert();
  assert(second);
  assert.equal(await markFeedbackDispatchedBulk(randomUUID(), [second.id]), 0);
  assert.equal(await markFeedbackDispatchedBulk(userId, [second.id]), 1);
  const [{ held }] =
    await sql`select requires_review as held from site_feedback where id = ${second.id}`;
  assert.equal(held, false);
  await sql.end();
  console.log(
    "Note migration, context persistence, tenant isolation and explicit promotion passed",
  );
  process.exit(0);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
