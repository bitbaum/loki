/**
 * Read-only bridge from Loki's existing Crew table to the work-order envelope.
 *
 * Human tasks, their status and their timeline remain authoritative in Crew.
 * This projection performs no write and NEVER produces an authorization stamp.
 * A task may be reassigned without a new assignee signature in today's Crew
 * model, so a historical "accepted" event is NOT proof that the current
 * assignee consented. Fix that binding before building a human dispatcher.
 */
import { HUMAN_TASK_STATUS, TASK_ACTOR, TASK_CURRENCIES, TASK_EVENT } from "@/config/crew";
import type { HumanTaskDetail } from "@/db/queries/human-tasks";
import type { WorkOrder, WorkPrice } from "./preflight";

export const CREW_WORK_CAPABILITY = "human.delegated_assignment";

/** Process-level requirements; they do not certify domain-specific quality. */
export const CREW_WORK_ACCEPTANCE_CRITERIA = [
  "The assignee records a delivery on this Crew assignment.",
  "The operator reviews that delivery and explicitly marks the assignment done.",
] as const;

export const CREW_PROJECTION_ISSUE = {
  PROJECT_REQUIRED: "project_required",
  ASSIGNEE_REQUIRED: "assignee_required",
  INVALID_REVISION: "invalid_revision",
  INVALID_FEE: "invalid_fee",
  CURRENCY_REQUIRED: "currency_required",
} as const;

export type CrewProjectionIssue =
  (typeof CREW_PROJECTION_ISSUE)[keyof typeof CREW_PROJECTION_ISSUE];

export type CrewWorkProjection = {
  /** Never an instruction to send or run anything. */
  readonly previewOnly: true;
  readonly source: {
    assignmentId: string;
    status: HumanTaskDetail["status"];
    updatedAt: string;
  };
  readonly order: WorkOrder | null;
  readonly issues: readonly CrewProjectionIssue[];
  readonly record: {
    /** Someone with the share link responded; identity is not re-verified here. */
    assigneeResponseRecorded: boolean;
    deliveryRecorded: boolean;
    ownerMarkedDone: boolean;
    /** False until Crew can cryptographically or transactionally bind consent to the assignee. */
    currentAssigneeConsentVerified: false;
    /**
     * Requires a real assignee delivery followed by the operator's DONE.
     * Not proof that the physical or domain-specific deliverable is correct.
     */
    workflowCompletionRecorded: boolean;
  };
};

/** Refuse unknown currencies and amounts more precise than the denomination. */
export function crewFeeToMinor(
  amount: number | null,
  currency: string | null,
): WorkPrice | null {
  if (amount === null) return null;
  if (!(TASK_CURRENCIES as readonly string[]).includes(currency ?? "")) return null;
  if (!Number.isFinite(amount) || amount < 0) return null;
  const decimals = currency === "BTC" ? 8 : 2;
  const fixed = amount.toFixed(decimals);
  // Do not silently round a quoted agreement to a different price.
  if (Number(fixed) !== amount) return null;
  const [whole, fraction = ""] = fixed.split(".");
  const minor = BigInt(whole) * BigInt(10 ** decimals) + BigInt(fraction || "0");
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { amountMinor: minor.toString(), currency: currency! };
}

/**
 * Map an owner-scoped database result. Do not accept this as a client request
 * body; the API must fetch it with getHumanTask(access.userId, id).
 */
export function projectCrewWork(task: HumanTaskDetail): CrewWorkProjection {
  const issues: CrewProjectionIssue[] = [];
  if (!task.projectId) issues.push(CREW_PROJECTION_ISSUE.PROJECT_REQUIRED);
  if (!task.assigneeId) issues.push(CREW_PROJECTION_ISSUE.ASSIGNEE_REQUIRED);

  // A timestamp gives a conservative preview revision, NOT a monotonic
  // authorization version. Never use it to mint signed dispatch stamps.
  const revision = task.updatedAt.getTime();
  if (!Number.isSafeInteger(revision) || revision < 1) {
    issues.push(CREW_PROJECTION_ISSUE.INVALID_REVISION);
  }

  let price: WorkPrice | undefined;
  if (task.feeAmount !== null) {
    const parsed = crewFeeToMinor(task.feeAmount, task.feeCurrency);
    if (!task.feeCurrency) issues.push(CREW_PROJECTION_ISSUE.CURRENCY_REQUIRED);
    else if (!parsed) issues.push(CREW_PROJECTION_ISSUE.INVALID_FEE);
    else price = parsed;
  } else if (task.feeCurrency) {
    issues.push(CREW_PROJECTION_ISSUE.INVALID_FEE);
  }

  const assigneeEvents = task.timeline.filter(
    (event) => event.kind === TASK_EVENT.STATUS && event.actor === TASK_ACTOR.ASSIGNEE,
  );
  const deliveryRecorded = assigneeEvents.some(
    (event) => event.status === HUMAN_TASK_STATUS.DELIVERED,
  );
  const sourceStatus = task.status;
  const ownerMarkedDone = sourceStatus === HUMAN_TASK_STATUS.DONE;
  const assigneeResponseRecorded = assigneeEvents.some(
    (event) =>
      event.status === HUMAN_TASK_STATUS.ACCEPTED ||
      event.status === HUMAN_TASK_STATUS.DECLINED ||
      event.status === HUMAN_TASK_STATUS.DELIVERED,
  );

  const order: WorkOrder | null =
    issues.length === 0 && task.projectId
      ? {
          id: task.id,
          revision,
          projectId: task.projectId,
          capability: CREW_WORK_CAPABILITY,
          description: task.brief?.trim() || task.title,
          acceptanceCriteria: CREW_WORK_ACCEPTANCE_CRITERIA,
          provider: { kind: "human", assignmentId: task.id },
          ...(price ? { price } : {}),
        }
      : null;

  return {
    previewOnly: true,
    source: {
      assignmentId: task.id,
      status: sourceStatus,
      updatedAt: task.updatedAt.toISOString(),
    },
    order,
    issues,
    record: {
      assigneeResponseRecorded,
      deliveryRecorded,
      ownerMarkedDone,
      currentAssigneeConsentVerified: false,
      workflowCompletionRecorded: ownerMarkedDone && deliveryRecorded,
    },
  };
}
