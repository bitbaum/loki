import { NextRequest, NextResponse } from "next/server";
import { readIdParam, jsonOk, jsonError } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { getActionById } from "@/db/queries/actions";

/**
 * GET /api/actions/[id]/status — where one queued action stands.
 *
 * For the approval card under a chat answer, which must read the real state
 * on every load (a draft approved elsewhere, an action that expired) instead
 * of offering buttons a reload would have to take back. Session-only, not
 * PIN-gated: the status word reveals nothing the chat did not already say.
 * Deciding still goes through /decision, which is.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(ctx.params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const action = await getActionById(userId, idOrResp);
  if (!action) return jsonError("Action not found", 404);
  return jsonOk({ status: action.status });
}
