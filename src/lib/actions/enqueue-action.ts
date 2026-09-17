/**
 * The one seam between "Loki wants to do X" and the operator finding out.
 *
 * Before this, three things were spread across every producer and drifted:
 * inserting the draft, deciding whether it needed a tap, and telling the
 * operator. The propose HTTP route did the first, the Approvals page did the
 * second, and nothing did the third — which is why an appointment asked for in
 * a chat could sit in a queue for seven hours without anyone being told.
 *
 * Every producer now calls enqueueAction and gets one of two outcomes, both
 * complete: `queued` (a decision is owed, and the operator has been handed it
 * with buttons) or `auto` (a standing rule covered it, it ran, and the operator
 * was told what was done in their name). There is no third outcome where
 * something is true in the database and unknown to the human.
 */
import {
  proposeAction,
  approveAction,
  type ActionRow,
  type ProposeActionInput,
} from "@/db/queries/actions";
import { recordActionAuditEvent } from "@/db/queries/control-audit-events";
import { getUserPreferences } from "@/db/queries/user-preferences";
import { finalizeApproved } from "@/lib/actions/finalize-approved";
import { standingApprovalVerdict } from "@/lib/actions/standing-approval";
import { notifyActionNeedsDecision } from "@/lib/actions/notify-decision";
import type { ExecuteActionResult } from "@/lib/actions/execute-action";

export type EnqueueOutcome =
  /** An identical draft title was already pending — nothing new was queued. */
  | { result: "deduped"; action: null }
  /** Waiting on the operator. `reason` is set when a standing rule declined. */
  | { result: "queued"; action: ActionRow; reason?: string }
  /** A standing rule approved it; `execution` is what the executor then did. */
  | { result: "auto"; action: ActionRow; execution: ExecuteActionResult };

export type EnqueueOptions = {
  /**
   * Did the operator ask for this, in words, just now?
   *
   * Gates the per-item Telegram card, and nothing else — it can never cause
   * something to execute. Spontaneous proposals (the check-in producer, the
   * advisor) pass false and stay in the hourly digest: a card for something
   * nobody asked for is the notification storm this fleet already learned not
   * to send.
   */
  operatorRequested?: boolean;
};

/**
 * Enqueue a proposed action, apply the operator's standing rules, and make sure
 * they know either way.
 *
 * Order matters and is not incidental. The row is INSERTED FIRST, always, even
 * when a standing rule will approve it a millisecond later: the queue is the
 * audit trail, and an action that executed without ever being a row is an
 * action with no record of having been proposed, approved, or done. The rule
 * changes who taps, never whether it is written down.
 */
export async function enqueueAction(
  userId: string,
  input: ProposeActionInput,
  options: EnqueueOptions = {},
): Promise<EnqueueOutcome> {
  const created = await proposeAction(userId, input);
  // Dedupe (partial unique index on pending titles) — the answer is "it is
  // already queued", which is not a failure and must not be reported as one.
  if (!created) return { result: "deduped", action: null };

  await recordActionAuditEvent(userId, created, "proposed");

  // A preferences read that throws must not turn into an execution. Failing to
  // learn the rule means we do not have one — the queue is the safe default.
  const standing = await getUserPreferences(userId)
    .then((p) => p.standingApprovals)
    .catch(() => [] as string[]);

  const verdict = standingApprovalVerdict({
    type: created.type,
    payload: created.payload,
    standingApprovals: standing,
  });

  if (!verdict.auto) {
    if (options.operatorRequested) {
      // Only surface a DECLINED standing rule's reason. "no standing approval
      // for this type" is the normal state of the queue, and printing it on
      // every card would read as an error report on working software.
      const explained = isDeclinedRule(standing, created.type) ? verdict.reason : undefined;
      await notifyActionNeedsDecision(userId, created, explained);
    }
    return { result: "queued", action: created, reason: verdict.reason };
  }

  // Approval given in advance is still approval: same transition, same SSOT
  // executor as a tap. The audit event records WHICH kind it was, so "who
  // approved this" always has an answer.
  const [approved] = await approveAction(created.id, userId);
  if (!approved) {
    // Lost a race (expired, or decided elsewhere between insert and approve).
    // Unknown is not yes — leave it alone rather than forcing the transition.
    return { result: "queued", action: created };
  }

  const execution = await finalizeApproved(userId, approved, { via: "standing-rule" });
  return { result: "auto", action: approved, execution };
}

/**
 * True when the operator HAS a standing rule for this type but the payload
 * check turned it down — the only case where explaining the fall-back helps.
 */
function isDeclinedRule(standing: readonly string[], type: ActionRow["type"]): boolean {
  return standing.includes(type);
}
