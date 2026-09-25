/**
 * Approve or reject a queued action over HTTP — the approve-from-chat seam.
 *
 * The Approvals page decides via server actions (src/app/actions.ts), which a
 * chat agent can't call. This route gives Loki (OpenClaw) the same decision
 * with the operator's own ck_* bearer token: George says "approve" in
 * WhatsApp, Loki POSTs here, the row actually advances.
 *
 * The IRON RULE holds unchanged: draft → approved → executed via the same
 * finalizeApproved SSOT the page uses — approval here is still the operator's
 * explicit word, just spoken in chat instead of clicked in the UI.
 */
import { NextRequest, NextResponse } from "next/server";
import { readIdParam, readJsonBody, jsonOk, jsonError, z } from "@/lib/api/route-helpers";
import { requirePrivateApiAccessWithBearer } from "@/lib/private-zone-api";
import { approveAction, rejectAction } from "@/db/queries/actions";
import { recordActionAuditEvent } from "@/db/queries/control-audit-events";
import { finalizeApproved } from "@/lib/actions/finalize-approved";
import { recoverEventPayloadFromText } from "@/lib/actions/calendar-event";

const DecisionBody = z.object({
  decision: z.enum(["approve", "reject"]),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const access = await requirePrivateApiAccessWithBearer();
  if (access instanceof NextResponse) return access;
  const { userId } = access;

  const idOrResp = await readIdParam(ctx.params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const dataOrResp = await readJsonBody(req, DecisionBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  if (dataOrResp.decision === "reject") {
    const [action] = await rejectAction(idOrResp, userId);
    if (!action) return jsonError("No open draft with that id", 404);
    await recordActionAuditEvent(userId, action, "rejected");
    return jsonOk({ id: action.id, status: action.status });
  }

  const [action] = await approveAction(idOrResp, userId);
  if (!action) return jsonError("No open draft with that id", 404);
  const result = await finalizeApproved(userId, action, {
    recoverEvent: recoverEventPayloadFromText,
  });
  return jsonOk({ id: action.id, status: action.status, result });
}
