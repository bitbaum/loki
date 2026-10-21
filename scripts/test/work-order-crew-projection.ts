// No DB, no network: read-only Crew → common work order projection.
// Automatically discovered by scripts/test-unit.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HUMAN_TASK_STATUS as S, TASK_ACTOR, TASK_EVENT } from "@/config/crew";
import type { HumanTaskDetail } from "@/db/queries/human-tasks";
import { crewFeeToMinor, projectCrewWork } from "@/lib/work-orders/crew-projection";

const time = new Date("2026-10-21T10:00:00.000Z");
const task = {
  id: "crew-task-1",
  userId: "operator-1",
  projectId: "loki-project-1",
  assigneeId: "person-1",
  title: "Inspect a refurbished laptop",
  brief: "Record the serial number and show a successful boot test.",
  status: S.DRAFT,
  feeAmount: null,
  feeCurrency: null,
  updatedAt: time,
  timeline: [],
} as HumanTaskDetail;

const statusEvent = (
  status: (typeof S)[keyof typeof S],
  actor: (typeof TASK_ACTOR)[keyof typeof TASK_ACTOR] = TASK_ACTOR.ASSIGNEE,
) => ({
  id: "event-1",
  kind: TASK_EVENT.STATUS,
  status,
  actor,
  note: null,
  createdAt: time,
});

const draft = projectCrewWork(task);
assert.equal(draft.previewOnly, true);
assert.deepEqual(draft.issues, []);
assert.deepEqual(draft.order?.provider, { kind: "human", assignmentId: task.id });
assert.equal(draft.order?.projectId, task.projectId);
assert.equal(draft.order?.description, task.brief);
assert.equal(draft.order?.revision, time.getTime());
assert.equal(draft.order?.price, undefined, "no stated fee does not create a payment");
assert.equal(draft.record.assigneeResponseRecorded, false, "draft has told nobody anything");
assert.equal(draft.record.currentAssigneeConsentVerified, false);

const asked = projectCrewWork({ ...task, status: S.ASSIGNED });
assert.equal(asked.record.assigneeResponseRecorded, false, "asked is not accepted");

const accepted = projectCrewWork({
  ...task,
  status: S.ACCEPTED,
  timeline: [statusEvent(S.ACCEPTED)],
});
assert.equal(accepted.record.assigneeResponseRecorded, true);
assert.equal(accepted.record.currentAssigneeConsentVerified, false);
assert.equal(accepted.record.workflowCompletionRecorded, false);

const operatorPretended = projectCrewWork({
  ...task,
  status: S.DONE,
  timeline: [statusEvent(S.DONE, TASK_ACTOR.OPERATOR)],
});
assert.equal(operatorPretended.record.ownerMarkedDone, true);
assert.equal(operatorPretended.record.deliveryRecorded, false);
assert.equal(operatorPretended.record.workflowCompletionRecorded, false);

const delivered = projectCrewWork({
  ...task,
  status: S.DELIVERED,
  timeline: [statusEvent(S.DELIVERED)],
});
assert.equal(delivered.record.deliveryRecorded, true);
assert.equal(delivered.record.workflowCompletionRecorded, false);

const complete = projectCrewWork({
  ...task,
  status: S.DONE,
  timeline: [statusEvent(S.DELIVERED), statusEvent(S.DONE, TASK_ACTOR.OPERATOR)],
});
assert.equal(complete.record.workflowCompletionRecorded, true);
assert.equal(complete.record.currentAssigneeConsentVerified, false);

const oldAcceptance = projectCrewWork({
  ...task,
  assigneeId: "a-new-person",
  status: S.ACCEPTED,
  timeline: [statusEvent(S.ACCEPTED)],
});
assert.equal(oldAcceptance.record.currentAssigneeConsentVerified, false);

const declined = projectCrewWork({
  ...task,
  status: S.DECLINED,
  timeline: [statusEvent(S.DECLINED)],
});
assert.equal(declined.record.assigneeResponseRecorded, true);
assert.equal(declined.record.workflowCompletionRecorded, false);

assert.deepEqual(projectCrewWork({ ...task, projectId: null }).issues, ["project_required"]);
assert.equal(projectCrewWork({ ...task, projectId: null }).order, null);
assert.deepEqual(projectCrewWork({ ...task, assigneeId: null }).issues, ["assignee_required"]);
assert.equal(projectCrewWork({ ...task, assigneeId: null }).order, null);
assert.deepEqual(projectCrewWork({ ...task, feeAmount: 25.0, feeCurrency: null }).issues, [
  "currency_required",
]);
assert.equal(
  projectCrewWork({ ...task, feeAmount: 25.0, feeCurrency: null }).order,
  null,
  "missing money terms must not be interpreted as free work",
);
assert.deepEqual(projectCrewWork({ ...task, feeAmount: 1.005, feeCurrency: "CHF" }).issues, [
  "invalid_fee",
]);
assert.equal(
  projectCrewWork({ ...task, feeAmount: 0.00000001, feeCurrency: "BTC" }).order?.price?.amountMinor,
  "1",
);
assert.deepEqual(crewFeeToMinor(12.5, "CHF"), { amountMinor: "1250", currency: "CHF" });
assert.deepEqual(crewFeeToMinor(0.0005, "BTC"), { amountMinor: "50000", currency: "BTC" });
assert.equal(crewFeeToMinor(1.001, "USD"), null);
assert.equal(crewFeeToMinor(-1, "CHF"), null);
assert.equal(crewFeeToMinor(Number.NaN, "CHF"), null);
assert.equal(crewFeeToMinor(10, "UNKNOWN"), null);

// An owner-scoped response must never leak the assignee's bearer token or
// private book fields to a different subsystem.
const sensitive = projectCrewWork({
  ...task,
  shareToken: "SECRET_DO_NOT_LEAK",
  assigneePayUrl: "https://orangecat.ch/profiles/private",
  reason: "DO_NOT_COPY_PERSONAL_NOTE",
});
const serialized = JSON.stringify(sensitive);
assert.ok(!serialized.includes("SECRET_DO_NOT_LEAK"));
assert.ok(!serialized.includes("DO_NOT_COPY_PERSONAL_NOTE"));
assert.ok(!serialized.includes("profiles/private"));

const route = readFileSync("src/app/api/crew/tasks/[id]/work-order/route.ts", "utf8");
assert.match(route, /requirePrivateApiAccess\(\)/);
assert.match(route, /getHumanTask\(access\.userId, idOrResp\)/);
assert.match(route, /projectCrewWork\(task\)/);
assert.match(route, /no-store/);
assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)\(/);

console.log("✓ Crew work-order projection — source status, money, consent and privacy");
