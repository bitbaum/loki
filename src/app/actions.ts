"use server";

import {
  approveAction,
  rejectAction,
  getActionById,
  updateDraftPayload,
  markActionExecuted,
} from "@/db/queries/actions";
import { setFeedbackStatus } from "@/db/queries/site-feedback";
import { planTrim } from "@/lib/actions/advisor";
import { RECOMMENDATION, type Recommendation } from "@/lib/actions/advice-rules";
import { dismissAlert } from "@/db/queries/alerts";
import { resolveEscalation } from "@/db/queries/run-escalations";
import { fulfillCommitment } from "@/db/queries/today";
import { cancelSubscription } from "@/db/queries/money";
import { createInteraction } from "@/db/queries/people";
import { patchGoal } from "@/db/queries/goals";
import { finalizeApproved } from "@/lib/actions/finalize-approved";
import { recoverEventPayloadFromText } from "@/lib/actions/calendar-event";
import type { ExecuteActionResult } from "@/lib/actions/execute-action";
import { recordActionAuditEvent } from "@/db/queries/control-audit-events";
import { requirePageUserId } from "@/lib/session";
import { isPrivateZoneLocked } from "@/lib/private-zone";
import { ROUTES } from "@/config/auth";
import { GOAL_STATUS, FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { INTERACTION_DIRECTION } from "@/lib/constants/statuses";
import { revalidatePath } from "next/cache";

export async function handleApprove(id: string): Promise<ExecuteActionResult> {
  const userId = await requirePageUserId();
  const [action] = await approveAction(id, userId);
  if (!action) return { executed: false, error: "not-found" };
  // Caller refreshes when the result is on screen. Immediate revalidate
  // deletes the card before the operator sees where the work went.
  return finalizeApproved(userId, action, { recoverEvent: recoverEventPayloadFromText });
}

export async function handleApproveAll(ids: string[]): Promise<{ count: number }> {
  const userId = await requirePageUserId();
  const results = await Promise.all(ids.map((id) => approveAction(id, userId)));
  const approved = results.flat();
  await Promise.all(
    approved.map((action) =>
      finalizeApproved(userId, action, { recoverEvent: recoverEventPayloadFromText }),
    ),
  );
  return { count: approved.length };
}

/** Operator sent the WhatsApp/email themselves. Log it and close the draft. */
export async function handleConfirmSent(id: string): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePageUserId();
  const action = await getActionById(userId, id);
  if (!action) return { ok: false, error: "not-found" };
  const [approved] = action.status === "draft" ? await approveAction(id, userId) : [action];
  if (!approved) return { ok: false, error: "not-found" };
  if (approved.entityId) {
    await createInteraction(userId, {
      entityId: approved.entityId,
      channel: String(approved.payload?.channel ?? "other"),
      direction: INTERACTION_DIRECTION.OUTBOUND,
      summary: approved.title,
    });
  }
  await recordActionAuditEvent(userId, approved, "approved");
  const done = await markActionExecuted(id, userId);
  if (!done) return { ok: false, error: "could-not-close" };
  await recordActionAuditEvent(userId, approved, "executed", { meta: { sentByOperator: true } });
  return { ok: true };
}

export async function handleReject(id: string) {
  const userId = await requirePageUserId();
  const [action] = await rejectAction(id, userId);
  if (action) await recordActionAuditEvent(userId, action, "rejected");
  revalidatePath(ROUTES.APP_HOME);
}

/** Archive the feedback rows an action clustered, so a rejected or trimmed-away
 *  submission stops coming back as next week's identical proposal. Best-effort:
 *  triage bookkeeping must never fail the decision the operator just made. */
async function archiveFeedback(userId: string, ids: string[]): Promise<void> {
  await Promise.all(
    ids.map((id) => setFeedbackStatus(userId, id, FEEDBACK_STATUS.ARCHIVED).catch(() => null)),
  );
}

/**
 * Apply one option from the Approval Queue advisor.
 *
 * `dispatch_trimmed` is the reason this exists rather than the popup just
 * calling approve/reject: it rewrites the draft's prompt to carry only the
 * credible reports, archives the ones it dropped, and only then approves. The
 * approval itself still goes through approveAction + finalizeApproved, so the
 * IRON RULE holds — draft → approved → executed, no bypass.
 */
export async function handleApplyAdvice(
  id: string,
  option: Recommendation,
): Promise<ExecuteActionResult | { executed: false; skipped: true }> {
  const userId = await requirePageUserId();

  if (option === RECOMMENDATION.REVIEW) return { executed: false, skipped: true };

  const action = await getActionById(userId, id);
  if (!action) return { executed: false, error: "not-found" };
  const feedbackIds = Array.isArray(action.payload?.feedbackIds)
    ? (action.payload.feedbackIds as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  if (option === RECOMMENDATION.SKIP) {
    await handleReject(id);
    await archiveFeedback(userId, feedbackIds);
    return { executed: false, skipped: true };
  }

  if (option === RECOMMENDATION.DISPATCH_TRIMMED) {
    const plan = planTrim({
      id: action.id,
      title: action.title,
      type: action.type,
      payload: action.payload,
      createdAt: action.createdAt,
      expiresAt: action.expiresAt,
    });
    // No plan means nothing was trimmable after all (payload edited since the
    // advice was fetched). Fall through to a plain dispatch rather than
    // silently approving a prompt the operator did not see.
    if (plan) {
      await updateDraftPayload(id, userId, {
        ...action.payload,
        body: plan.body,
        feedbackIds: plan.keepFeedbackIds,
      });
      await archiveFeedback(userId, plan.dropFeedbackIds);
    }
  }

  return handleApprove(id);
}

export async function handleDismissAlert(id: string) {
  const userId = await requirePageUserId();
  const [dismissed] = await dismissAlert(id, userId);

  // Dismissing "project X: 4 consecutive failed runs" IS the operator saying
  // they have handled it, so it must also close the ladder that raised it.
  //
  // Without this, `resolved_by = 'manual'` was declared in the schema and
  // written by nothing — the only exit from the ladder was a qualifying run
  // close, so a project that had stopped running could never be cleared by
  // anyone. Dismissing the alert silenced the symptom and left the state.
  if (dismissed?.type === "run_escalation") {
    const projectKey = dismissed.metadata?.projectKey;
    if (typeof projectKey === "string" && projectKey.length > 0) {
      await resolveEscalation(userId, projectKey, "manual");
    }
  }

  revalidatePath(ROUTES.APP_HOME);
}

export async function handleFulfillCommitment(id: string) {
  const userId = await requirePageUserId();
  if (await isPrivateZoneLocked(userId)) return; // UI should not call when locked
  await fulfillCommitment(id, userId);
  revalidatePath(ROUTES.APP_HOME);
}

export async function handleCancelSubscription(id: string) {
  const userId = await requirePageUserId();
  await cancelSubscription(id, userId);
  revalidatePath("/money");
}

export async function handleAbandonGoal(id: string) {
  const userId = await requirePageUserId();
  if (await isPrivateZoneLocked(userId)) return; // UI should not call when locked; private page gated
  await patchGoal(userId, id, { status: GOAL_STATUS.ABANDONED });
  revalidatePath(ROUTES.APP_HOME);
  revalidatePath("/goals");
}
