// Pure unit test: automatically discovered by scripts/test-unit.ts.
// Run: npx tsx scripts/test/work-order-preflight.ts
import assert from "node:assert/strict";
import {
  PREFLIGHT_BLOCKER as B,
  ROBOT_READINESS_MAX_AGE_MS,
  reviewDispatchPrerequisites,
  type WorkOrder,
  type DispatchEvidence,
} from "@/lib/work-orders/preflight";

const base: WorkOrder = {
  id: "order-1",
  revision: 1,
  projectId: "project-1",
  capability: "code.typescript",
  description: "Implement and test a typed adapter.",
  acceptanceCriteria: ["Typecheck succeeds", "Behavioral tests pass"],
  provider: { kind: "agent", agentId: "codex-1" },
};

const nowMs = 20_000;
const owner = { orderId: base.id, revision: 1, actorId: "operator-1" };
const evidence: DispatchEvidence = { nowMs, ownerApproval: owner };
const review = (order: WorkOrder, context: DispatchEvidence = evidence) =>
  reviewDispatchPrerequisites(order, context);

assert.deepEqual(
  review(base, { nowMs }).blockers,
  [B.OWNER_APPROVAL],
  "no owner's approval means no agent dispatch",
);
assert.deepEqual(review(base).blockers, [], "approved free agent work has no extra requirements");
assert.equal(review(base).prerequisitesMet, true);
assert.deepEqual(
  review({ ...base, revision: 2 }).blockers,
  [B.OWNER_APPROVAL],
  "editing scope invalidates the approval",
);
assert.deepEqual(
  review(base, { ...evidence, ownerApproval: { ...owner, orderId: "another" } }).blockers,
  [B.OWNER_APPROVAL],
  "an approval for another project cannot cross over",
);
assert.deepEqual(
  review({ ...base, acceptanceCriteria: [] }).blockers,
  [B.INVALID_ORDER],
  "a work order without measurable acceptance criteria is invalid",
);
assert.deepEqual(
  review({ ...base, provider: { kind: "agent", agentId: "" } }).blockers,
  [B.INVALID_ORDER],
);
assert.deepEqual(
  review(base, { ...evidence, nowMs: NaN }).blockers,
  [B.INVALID_ORDER],
  "an invalid server clock must fail closed",
);

const paid: WorkOrder = {
  ...base,
  price: { amountMinor: "2500", currency: "CHF" },
};
assert.deepEqual(review(paid).blockers, [B.SPEND_APPROVAL]);
assert.deepEqual(
  review(paid, {
    ...evidence,
    spendApproval: { ...owner, amountMinor: "2501", currency: "CHF" },
  }).blockers,
  [B.SPEND_APPROVAL],
  "approval for a different quote is not good enough",
);
assert.equal(
  review(paid, {
    ...evidence,
    spendApproval: { ...owner, amountMinor: "2500", currency: "CHF" },
  }).prerequisitesMet,
  true,
);
assert.deepEqual(
  review({ ...paid, price: { amountMinor: "25.00", currency: "CHF" } }).blockers,
  [B.INVALID_ORDER],
  "money never enters as a float or a major-unit decimal",
);
assert.equal(
  review({ ...base, price: { amountMinor: "0", currency: "BTC" } }).prerequisitesMet,
  true,
  "no spending permission is required for a truly zero-price order",
);

const human: WorkOrder = {
  ...base,
  capability: "repair.inspect_laptop",
  provider: { kind: "human", assignmentId: "crew-task-1" },
};
assert.deepEqual(
  review(human).blockers,
  [B.PROVIDER_ACCEPTANCE],
  "asking a person is not their consent to perform the work",
);
assert.deepEqual(
  review(human, {
    ...evidence,
    providerAcceptance: { orderId: base.id, revision: 1, providerRef: "crew-task-2" },
  }).blockers,
  [B.PROVIDER_ACCEPTANCE],
);
assert.equal(
  review(human, {
    ...evidence,
    providerAcceptance: { orderId: base.id, revision: 1, providerRef: "crew-task-1" },
  }).prerequisitesMet,
  true,
);

const service: WorkOrder = {
  ...base,
  provider: { kind: "service", offerId: "offer-1" },
};
assert.deepEqual(review(service).blockers, [B.PROVIDER_ACCEPTANCE]);
assert.equal(
  review(service, {
    ...evidence,
    providerAcceptance: { orderId: base.id, revision: 1, providerRef: "offer-1" },
  }).prerequisitesMet,
  true,
);

const robot: WorkOrder = {
  ...base,
  capability: "vacuum.clean_zone",
  provider: { kind: "robot", robotId: "vacuum-1", gatewayId: "gateway-1" },
};
const ready = {
  orderId: robot.id,
  revision: 1,
  robotId: "vacuum-1",
  gatewayId: "gateway-1",
  capability: robot.capability,
  checkedAtMs: nowMs,
  ready: true,
};
assert.deepEqual(review(robot).blockers, [B.ROBOT_READINESS]);
assert.equal(review(robot, { ...evidence, robotReadiness: ready }).prerequisitesMet, true);
assert.deepEqual(
  review(robot, {
    ...evidence,
    robotReadiness: { ...ready, robotId: "somebody-elses-robot" },
  }).blockers,
  [B.ROBOT_READINESS],
);
assert.deepEqual(
  review(robot, { ...evidence, robotReadiness: { ...ready, ready: false } }).blockers,
  [B.ROBOT_READINESS],
);
assert.deepEqual(
  review(robot, { ...evidence, robotReadiness: { ...ready, checkedAtMs: nowMs + 1 } }).blockers,
  [B.ROBOT_READINESS],
  "future-dated telemetry is not current safety evidence",
);
assert.deepEqual(
  review(robot, {
    ...evidence,
    nowMs: nowMs + ROBOT_READINESS_MAX_AGE_MS + 1,
    robotReadiness: ready,
  }).blockers,
  [B.ROBOT_READINESS],
  "a stale ready flag must not authorize physical action",
);
assert.deepEqual(
  review(robot, {
    ...evidence,
    ownerApproval: null,
    robotReadiness: ready,
  }).blockers,
  [B.OWNER_APPROVAL],
  "device readiness never replaces the owner's permission",
);
assert.deepEqual(
  review(
    { ...robot, revision: 2, price: { amountMinor: "1", currency: "BTC" } },
    { ...evidence, robotReadiness: ready },
  ).blockers,
  [B.OWNER_APPROVAL, B.SPEND_APPROVAL, B.ROBOT_READINESS],
  "revision changes invalidate every independent credential",
);

console.log("✓ work-order preflight — consent, scope, money and robot freshness");
