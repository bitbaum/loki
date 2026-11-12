import { NextRequest, NextResponse } from "next/server";
import { readIdParam, jsonOk, jsonError } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { readFeedbackStatus } from "@/lib/feedback/agent-filing";

/**
 * Where one report is, in the six canonical states (lib/feedback/
 * canonical-status.ts) — what an agent polls after POST /api/projects/[id]/
 * feedback returns its `statusUrl`. Bearer `ck_` token or session.
 *
 * Two shapes, by seat, never one with holes: an owner or editor gets the
 * whole status (state, cause, nextAction, evidence); anyone else gets the
 * state, label, cause, a reason and a next step (seatStatus: never empty on
 * Needs you) for a report THEY filed, and nothing of the machine
 * (reporter-view.ts keeps the same line). Anyone else's report is a 404.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const status = await readFeedbackStatus(userId, idOrResp);
  if (!status) return jsonError("Feedback not found", 404);
  return jsonOk(status, { headers: { "Cache-Control": "no-store" } });
}
