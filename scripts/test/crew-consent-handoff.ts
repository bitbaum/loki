// Pure regression suite. The database write path additionally serializes all
// edits, shares, revocations and replies with SELECT ... FOR UPDATE.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { HumanTask } from "@/db/schema/human-tasks";
import { changesCrewConsentTerms, WORK_TERMS_FIELDS } from "@/lib/crew/consent-terms";
import { HUMAN_TASK_STATUS } from "@/lib/constants/statuses";

const sample = {
  id: "task-1",
  assigneeId: "person-1",
  projectId: "project-1",
  title: "Inspect the laptop",
  brief: "Run diagnostics",
  reason: "Make this computer usable",
  dueDate: new Date("2026-10-25T13:00:00Z"),
  feeAmount: 0.0005,
  feeCurrency: "BTC",
  status: HUMAN_TASK_STATUS.ACCEPTED,
} as HumanTask;

assert.deepEqual(WORK_TERMS_FIELDS, [
  "assigneeId",
  "projectId",
  "title",
  "brief",
  "reason",
  "dueDate",
  "feeAmount",
  "feeCurrency",
]);

assert.equal(changesCrewConsentTerms(sample, {}), false);
assert.equal(changesCrewConsentTerms(sample, { title: sample.title }), false);
assert.equal(
  changesCrewConsentTerms(sample, { dueDate: new Date(sample.dueDate!.getTime()) }),
  false,
);
assert.equal(changesCrewConsentTerms(sample, { feeAmount: sample.feeAmount }), false);
assert.equal(changesCrewConsentTerms(sample, { reason: sample.reason }), false);
assert.equal(changesCrewConsentTerms(sample, { assigneeId: "person-2" }), true);
assert.equal(changesCrewConsentTerms(sample, { assigneeId: null }), true);
assert.equal(changesCrewConsentTerms(sample, { projectId: "project-2" }), true);
assert.equal(changesCrewConsentTerms(sample, { title: "Inspect a server" }), true);
assert.equal(changesCrewConsentTerms(sample, { brief: null }), true);
assert.equal(changesCrewConsentTerms(sample, { reason: "Different purpose" }), true);
assert.equal(changesCrewConsentTerms(sample, { dueDate: null }), true);
assert.equal(changesCrewConsentTerms(sample, { dueDate: new Date("2026-10-26T13:00:00Z") }), true);
assert.equal(changesCrewConsentTerms(sample, { feeAmount: 0.0006 }), true);
assert.equal(changesCrewConsentTerms(sample, { feeCurrency: "CHF" }), true);

// The central database writer, not the UI, enforces the guard. Assert the
// structural properties, while Postgres CI covers query execution separately.
const db = readFileSync("src/db/queries/human-tasks.ts", "utf8");
const patches = [
  "export async function patchHumanTask(",
  "export async function shareHumanTask(",
  "export async function revokeHumanTaskShare(",
  "export async function respondToSharedTask(",
];
for (let i = 0; i < patches.length; i++) {
  const start = db.indexOf(patches[i]);
  const stop =
    i + 1 < patches.length ? db.indexOf(patches[i + 1]) : db.indexOf("/** Everything still open");
  const functionBody = db.slice(start, stop);
  assert.ok(start >= 0 && stop > start, `missing writer ${patches[i]}`);
  assert.match(functionBody, /db\.transaction\(async \(tx\)/, `transaction needed: ${patches[i]}`);
  assert.match(functionBody, /\.for\("update"\)/, `lock needed: ${patches[i]}`);
  assert.match(functionBody, /tx\.insert\(humanTaskEvents\)/, `atomic event: ${patches[i]}`);
}
assert.match(db, /changesCrewConsentTerms\(existing, patch\)/);
assert.match(db, /patch\.revokedAt = now/);
assert.match(db, /patch\.respondedAt = null/);
assert.match(db, /patch\.deliveredAt = null/);
assert.match(db, /patch\.completedAt = null/);
const reply = db.slice(db.indexOf("export async function respondToSharedTask("));
assert.match(reply, /eq\(humanTasks\.shareToken, token\)/);
assert.match(reply, /isNull\(humanTasks\.revokedAt\)/);
const route = readFileSync("src/app/api/crew/tasks/[id]/route.ts", "utf8");
assert.match(route, /isTaskTransitionError\(e\) \|\| isTaskShareError\(e\)/);

console.log("✓ Crew consent: changed terms invalidate old asks and concurrent writes are locked");
