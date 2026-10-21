// Automatically discovered by scripts/test-unit.ts; needs no DB or network.
// Run: npx tsx scripts/test/work-order-preflight.ts
import assert from "node:assert/strict";
import {
  PREFLIGHT_BLOCKER as B,
  ROBOT_READINESS_MAX_AGE_MS,
  reviewDispatchPrerequisites,
  type DispatchEvidence,
  type PreflightBlocker,
  type WorkOrder,
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

function expect(
  order: WorkOrder,
  blockers: PreflightBlocker[],
  diff: Partial<DispatchEvidence> = {},
) {
  const result = reviewDispatchPrerequisites(order, { ...evidence, ...diff });
  assert.deepEqual(result.blockers, blockers);
  assert.equal(result.prerequisitesMet, blockers.length === 0);
}

// Nobody may execute just because an agent proposed the task.
expect(base, [B.OWNER_APPROVAL], { ownerApproval: null });
expect(base, []);
expect({ ...base, revision: 2 }, [B.OWNER_APPROVAL]);
expect(base, [B.OWNER_APPROVAL], { ownerApproval: { ...owner, orderId: "other" } });
expect({ ...base, acceptanceCriteria: [] }, [B.INVALID_ORDER]);
expect({ ...base, provider: { kind: "agent", agentId: "" } }, [B.INVALID_ORDER]);
expect(base, [B.INVALID_ORDER], { nowMs: NaN });

// A spend authorization must match the exact canonical amount and currency.
const paid: WorkOrder = { ...base, price: { amountMinor: "2500", currency: "CHF" } };
const spend = { ...owner, amountMinor: "2500", currency: "CHF" };
expect(paid, [B.SPEND_APPROVAL]);
expect(paid, [B.SPEND_APPROVAL], { spendApproval: { ...spend, amountMinor: "2501" } });
expect(paid, [B.SPEND_APPROVAL], { spendApproval: { ...spend, currency: "BTC" } });
expect(paid, [], { spendApproval: spend });
expect({ ...paid, revision: 2 }, [B.OWNER_APPROVAL, B.SPEND_APPROVAL]);
expect({ ...paid, price: { ...paid.price!, amountMinor: "25.00" } }, [B.INVALID_ORDER]);
expect({ ...base, price: { amountMinor: "0", currency: "BTC" } }, []);

// An offered assignment is not a person's consent to perform the work.
const human: WorkOrder = {
  ...base,
  capability: "repair.inspect_laptop",
  provider: { kind: "human", assignmentId: "crew-task-1" },
};
const personAccepted = { orderId: base.id, revision: 1, providerRef: "crew-task-1" };
expect(human, [B.PROVIDER_ACCEPTANCE]);
expect(human, [B.PROVIDER_ACCEPTANCE], {
  providerAcceptance: { ...personAccepted, providerRef: "somebody-else" },
});
expect(human, [], { providerAcceptance: personAccepted });

// An external workshop must accept a specific offer too.
const service: WorkOrder = { ...base, provider: { kind: "service", offerId: "offer-1" } };
expect(service, [B.PROVIDER_ACCEPTANCE]);
expect(service, [], {
  providerAcceptance: { ...personAccepted, providerRef: "offer-1" },
});

// Hardware reports are scoped to a device, a gateway, a capability and a time.
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
expect(robot, [B.ROBOT_READINESS]);
expect(robot, [], { robotReadiness: ready });
expect(robot, [B.ROBOT_READINESS], {
  robotReadiness: { ...ready, robotId: "wrong-robot" },
});
expect(robot, [B.ROBOT_READINESS], {
  robotReadiness: { ...ready, gatewayId: "wrong-gateway" },
});
expect(robot, [B.ROBOT_READINESS], {
  robotReadiness: { ...ready, capability: "robot.other_capability" },
});
expect(robot, [B.ROBOT_READINESS], { robotReadiness: { ...ready, ready: false } });
expect(robot, [B.ROBOT_READINESS], {
  robotReadiness: { ...ready, checkedAtMs: nowMs + 1 },
});
expect(robot, [B.ROBOT_READINESS], {
  nowMs: nowMs + ROBOT_READINESS_MAX_AGE_MS + 1,
  robotReadiness: ready,
});
expect(robot, [B.OWNER_APPROVAL], {
  ownerApproval: null,
  robotReadiness: ready,
});
expect(
  { ...robot, revision: 2, price: { amountMinor: "1", currency: "BTC" } },
  [B.OWNER_APPROVAL, B.SPEND_APPROVAL, B.ROBOT_READINESS],
  { robotReadiness: ready },
);

console.log("✓ work-order preflight — consent, scope, money and robot freshness");
