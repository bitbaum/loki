/**
 * A provider-neutral work-order envelope for Loki's execution plane.
 *
 * No new table, dispatcher, approval source or payment ledger lives here.
 * Existing agent runs and Crew assignments remain authoritative. A robot
 * gateway will be authoritative for device state and safety.
 *
 * This is a PURE preflight of already-authenticated evidence. Neither an AI
 * model nor a client may mint the proof objects. The executor MUST re-check
 * current permissions, quote, hardware interlocks and state before acting.
 */
export type WorkProvider =
  | { kind: "agent"; agentId: string }
  | { kind: "human"; assignmentId: string }
  | { kind: "robot"; robotId: string; gatewayId: string }
  | { kind: "service"; offerId: string };

export type WorkPrice = {
  /** Canonical unsigned integer in the currency's smallest unit; never float. */
  amountMinor: string;
  currency: string;
};

export type WorkOrder = {
  id: string;
  /** Increment whenever scope, provider, requirements or price change. */
  revision: number;
  projectId: string;
  capability: string;
  description: string;
  acceptanceCriteria: readonly string[];
  provider: WorkProvider;
  price?: WorkPrice;
};

export type ScopedStamp = {
  orderId: string;
  revision: number;
};

export type ApprovalStamp = ScopedStamp & {
  /** Must be authenticated and authorized by the calling domain service. */
  actorId: string;
};

export type AcceptanceStamp = ScopedStamp & {
  /** Crew assignment ID or accepted external offer ID, not a person for sale. */
  providerRef: string;
};

export type SpendApprovalStamp = ApprovalStamp & WorkPrice;

/**
 * Snapshot asserted by a trusted robot gateway. It is NOT a substitute for
 * local safety interlocks, operator authority, or per-command checks.
 */
export type RobotReadinessStamp = ScopedStamp & {
  robotId: string;
  gatewayId: string;
  capability: string;
  checkedAtMs: number;
  ready: boolean;
};

export type DispatchEvidence = {
  ownerApproval?: ApprovalStamp | null;
  providerAcceptance?: AcceptanceStamp | null;
  spendApproval?: SpendApprovalStamp | null;
  robotReadiness?: RobotReadinessStamp | null;
  /** Supplied by the trusted server clock, not a browser or an AI response. */
  nowMs: number;
};

export const ROBOT_READINESS_MAX_AGE_MS = 5_000;

export const PREFLIGHT_BLOCKER = {
  INVALID_ORDER: "invalid_order",
  OWNER_APPROVAL: "owner_approval_required",
  PROVIDER_ACCEPTANCE: "provider_acceptance_required",
  SPEND_APPROVAL: "spend_approval_required",
  ROBOT_READINESS: "robot_readiness_required",
} as const;

export type PreflightBlocker = (typeof PREFLIGHT_BLOCKER)[keyof typeof PREFLIGHT_BLOCKER];

export type PreflightResult = {
  /** Prerequisites only; NEVER execute solely because this is true. */
  prerequisitesMet: boolean;
  blockers: readonly PreflightBlocker[];
};

function present(value: string): boolean {
  return value.trim().length > 0;
}

function validPrice(price: WorkPrice): boolean {
  return /^(0|[1-9][0-9]*)$/.test(price.amountMinor) &&
    /^[A-Z][A-Z0-9]{1,11}$/.test(price.currency);
}

function validOrder(order: WorkOrder): boolean {
  if (!present(order.id) || !present(order.projectId) || !present(order.capability)) return false;
  if (!present(order.description) || !Number.isSafeInteger(order.revision) || order.revision < 1) {
    return false;
  }
  if (
    order.acceptanceCriteria.length === 0 ||
    order.acceptanceCriteria.some((criterion) => !present(criterion))
  ) return false;
  if (order.price && !validPrice(order.price)) return false;
  switch (order.provider.kind) {
    case "agent":
      return present(order.provider.agentId);
    case "human":
      return present(order.provider.assignmentId);
    case "robot":
      return present(order.provider.robotId) && present(order.provider.gatewayId);
    case "service":
      return present(order.provider.offerId);
    default:
      return false;
  }
}

function correctScope(order: WorkOrder, stamp: ScopedStamp | null | undefined): boolean {
  return stamp?.orderId === order.id && stamp.revision === order.revision;
}

function validApproval(order: WorkOrder, stamp: ApprovalStamp | null | undefined): boolean {
  return correctScope(order, stamp) && Boolean(stamp && present(stamp.actorId));
}

function providerRef(order: WorkOrder): string | null {
  switch (order.provider.kind) {
    case "human":
      return order.provider.assignmentId;
    case "service":
      return order.provider.offerId;
    default:
      return null;
  }
}

/**
 * Check required evidence before an executor attempts a command. No I/O.
 *
 * A verified owner approval is always required. A person must accept their
 * own assignment; a service provider must accept the quoted engagement.
 * Paid work needs an approval pinned to the exact quote. Robots additionally
 * need a fresh, capability-scoped ready signal from their trusted gateway.
 */
export function reviewDispatchPrerequisites(
  order: WorkOrder,
  evidence: DispatchEvidence,
): PreflightResult {
  if (!validOrder(order) || !Number.isFinite(evidence.nowMs)) {
    return { prerequisitesMet: false, blockers: [PREFLIGHT_BLOCKER.INVALID_ORDER] };
  }

  const blockers: PreflightBlocker[] = [];
  if (!validApproval(order, evidence.ownerApproval)) {
    blockers.push(PREFLIGHT_BLOCKER.OWNER_APPROVAL);
  }

  const ref = providerRef(order);
  if (ref !== null) {
    if (
      !correctScope(order, evidence.providerAcceptance) ||
      evidence.providerAcceptance?.providerRef !== ref
    ) {
      blockers.push(PREFLIGHT_BLOCKER.PROVIDER_ACCEPTANCE);
    }
  }

  if (order.price && order.price.amountMinor !== "0") {
    const approval = evidence.spendApproval;
    if (
      !validApproval(order, approval) ||
      approval?.amountMinor !== order.price.amountMinor ||
      approval?.currency !== order.price.currency
    ) {
      blockers.push(PREFLIGHT_BLOCKER.SPEND_APPROVAL);
    }
  }

  if (order.provider.kind === "robot") {
    const status = evidence.robotReadiness;
    if (
      !correctScope(order, status) ||
      !status ||
      status.robotId !== order.provider.robotId ||
      status.gatewayId !== order.provider.gatewayId ||
      status.capability !== order.capability ||
      status.ready !== true ||
      !Number.isFinite(status.checkedAtMs) ||
      status.checkedAtMs > evidence.nowMs ||
      evidence.nowMs - status.checkedAtMs > ROBOT_READINESS_MAX_AGE_MS
    ) {
      blockers.push(PREFLIGHT_BLOCKER.ROBOT_READINESS);
    }
  }

  return { prerequisitesMet: blockers.length === 0, blockers };
}
