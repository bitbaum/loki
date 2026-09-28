/**
 * Approve or reject one queued action, as the operator's explicit word.
 *
 * The chat decision route (/api/actions/[id]/decision) and the MCP server's
 * loki_decide both land here, so a decision spoken in Telegram and one spoken
 * through a connected AI app cannot drift apart. The Approvals page and the
 * one-tap link keep their own callers of the same two primitives — they carry
 * page-specific steps (revalidation, token claims) this seam does not need.
 *
 * The IRON RULE holds unchanged: draft → approved → executed through
 * finalizeApproved, the SSOT every approval surface shares.
 */
import { approveAction, rejectAction } from "@/db/queries/actions";
import { recordActionAuditEvent } from "@/db/queries/control-audit-events";
import { finalizeApproved } from "@/lib/actions/finalize-approved";
import { recoverEventPayloadFromText } from "@/lib/actions/calendar-event";
import type { ExecuteActionResult } from "@/lib/actions/execute-action";

export type DecideActionOutcome =
  /** No open draft with that id belongs to this user — already decided, or never theirs. */
  { found: false } | { found: true; id: string; status: string; result?: ExecuteActionResult };

export async function decideAction(
  userId: string,
  id: string,
  decision: "approve" | "reject",
  extra?: { reason?: string; meta?: Record<string, unknown> },
): Promise<DecideActionOutcome> {
  if (decision === "reject") {
    const [action] = await rejectAction(id, userId);
    if (!action) return { found: false };
    await recordActionAuditEvent(userId, action, "rejected", extra);
    return { found: true, id: action.id, status: action.status };
  }

  const [action] = await approveAction(id, userId);
  if (!action) return { found: false };
  const result = await finalizeApproved(userId, action, {
    recoverEvent: recoverEventPayloadFromText,
  });
  return { found: true, id: action.id, status: action.status, result };
}
