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
 * explicit word, just spoken in chat instead of clicked in the UI. The
 * decision itself lives in lib/actions/decide-action.ts, shared with the MCP
 * server's loki_decide.
 */
import { NextRequest, NextResponse } from "next/server";
import { readIdParam, readJsonBody, jsonOk, jsonError, z } from "@/lib/api/route-helpers";
import { requirePrivateApiAccessWithBearer } from "@/lib/private-zone-api";
import { decideAction } from "@/lib/actions/decide-action";

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

  const outcome = await decideAction(userId, idOrResp, dataOrResp.decision);
  if (!outcome.found) return jsonError("No open draft with that id", 404);
  return jsonOk({
    id: outcome.id,
    status: outcome.status,
    ...(outcome.result !== undefined ? { result: outcome.result } : {}),
  });
}
