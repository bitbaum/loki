import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePrivateApiAccessWithBearer } from "@/lib/private-zone-api";
import { readJsonBody } from "@/lib/api/route-helpers";
import { enqueueAction } from "@/lib/actions/enqueue-action";
import { ACTION_TYPE } from "@/lib/constants/statuses";

const ProposeActionBody = z.object({
  type: z.enum(Object.values(ACTION_TYPE) as [string, ...string[]]),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  reasoning: z.string().trim().max(2000).optional(),
  entityId: z.string().uuid().optional(),
  /**
   * Did the operator ask for this in words, just now? Gates the per-item
   * Telegram card only — it can never cause anything to execute. Defaults true
   * because the callers here are chat surfaces relaying a live request; a
   * background producer passes false and stays in the hourly digest.
   */
  operatorRequested: z.boolean().default(true),
  expiresAt: z
    .string()
    .refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid date")
    .optional(),
});

/**
 * Producer seam for Loki's action queue — and the seam the chat surfaces use.
 *
 * Enqueues through the SSOT producer (lib/actions/enqueue-action.ts), which
 * applies the operator's standing approvals and makes sure they hear about it
 * either way.
 *
 * The IRON RULE is unchanged in substance: nothing executes that the operator
 * did not approve. What changed is that approval may have been given in
 * advance, and only for types whose worst case is a row they delete.
 */
export async function POST(req: NextRequest) {
  const access = await requirePrivateApiAccessWithBearer();
  if (access instanceof NextResponse) return access;
  const { userId } = access;

  const dataOrResp = await readJsonBody(req, ProposeActionBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const body = dataOrResp;

  const outcome = await enqueueAction(
    userId,
    {
      type: body.type as (typeof ACTION_TYPE)[keyof typeof ACTION_TYPE],
      title: body.title,
      description: body.description,
      payload: body.payload,
      reasoning: body.reasoning,
      entityId: body.entityId,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    },
    { operatorRequested: body.operatorRequested },
  );

  // Re-proposal of an already-pending title dedupes (partial unique index).
  if (outcome.result === "deduped") {
    return NextResponse.json({ ok: true, deduped: true }, { status: 200 });
  }

  // The caller is usually a chat agent about to tell the operator what
  // happened, so the response has to let it say the TRUE thing. `status`
  // separates "queued for your yes" from "done under your standing rule";
  // reporting either as the other is the over-claim the queue exists to stop.
  return NextResponse.json(
    {
      ok: true,
      action: outcome.action,
      status: outcome.result === "auto" ? "auto-approved" : "awaiting-approval",
      ...(outcome.result === "auto"
        ? { executed: outcome.execution.executed, deferred: outcome.execution.deferred ?? false }
        : { reason: outcome.reason }),
    },
    { status: 201 },
  );
}
