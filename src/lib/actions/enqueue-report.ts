/**
 * What a chat surface may truthfully SAY about an enqueued action.
 *
 * The caller is usually a model about to tell the operator what happened, so
 * the report has to let it say the TRUE thing. `status` separates "queued for
 * your yes" from "done under your standing rule"; reporting either as the
 * other is the over-claim the queue exists to stop.
 *
 * Shared by POST /api/actions/propose (the Telegram skill's `book`) and the
 * MCP server's loki_book, so the two can never describe the same outcome
 * differently. Type-only imports: this stays loadable without a database.
 */
import type { EnqueueOutcome } from "@/lib/actions/enqueue-action";
import type { ActionRow } from "@/db/queries/actions";

export type EnqueueReport =
  /** An identical draft title was already pending; nothing new was queued. */
  | { deduped: true }
  | {
      deduped?: false;
      action: ActionRow;
      status: "auto-approved";
      executed: boolean;
      deferred: boolean;
    }
  | { deduped?: false; action: ActionRow; status: "awaiting-approval"; reason?: string };

export function enqueueReport(outcome: EnqueueOutcome): EnqueueReport {
  if (outcome.result === "deduped") return { deduped: true };
  if (outcome.result === "auto") {
    return {
      action: outcome.action,
      status: "auto-approved",
      executed: outcome.execution.executed,
      deferred: outcome.execution.deferred ?? false,
    };
  }
  return { action: outcome.action, status: "awaiting-approval", reason: outcome.reason };
}
