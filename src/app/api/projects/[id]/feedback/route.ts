import { NextRequest, NextResponse } from "next/server";
import { readIdParam, jsonOk, jsonError } from "@/lib/api/route-helpers";
import { getSessionUserId } from "@/lib/session";
import { getFeedbackLoopMetrics, listProjectFeedback } from "@/db/queries/site-feedback";
import { attachFeedbackWork } from "@/lib/feedback/attach-work";
import { getProjectAccess } from "@/db/queries/project-access";

/** Per-project feedback inbox (visitor submissions from the embed widget)
 *  plus the loop metrics (resolved count, median report→fix). Each row
 *  includes `work` — honest phase/label (not started / queued / working / …). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const access = await getProjectAccess(userId, idOrResp);
  if (!access) return jsonError("Project not found", 404);
  const [raw, metrics] = await Promise.all([
    listProjectFeedback(access.ownerUserId, idOrResp),
    getFeedbackLoopMetrics(access.ownerUserId, idOrResp).catch(() => null),
  ]);
  const feedback = await attachFeedbackWork(access.ownerUserId, raw);
  return jsonOk({ feedback, metrics, access: { role: access.role, canEdit: access.canEdit } });
}
