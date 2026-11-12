import { NextRequest, NextResponse } from "next/server";
import { readIdParam, readJsonBody, jsonOk, jsonError } from "@/lib/api/route-helpers";
import { getApiUserId, getSessionUserId } from "@/lib/session";
import { getFeedbackLoopMetrics, listProjectFeedback } from "@/db/queries/site-feedback";
import { AgentFiling, fileAgentFeedback } from "@/lib/feedback/agent-filing";
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

/**
 * An agent files a report with its own seat's Bearer token (`ck_…`) — the
 * same inbox the widget fills, no second one. Any seat on the project may
 * file (a reporter seat included); filing is NOT permission to build: the row
 * is `source: agent`, which waits for a tap (waitsForATap). Starting work is
 * the existing POST /api/feedback/[id]/dispatch, by an owner or editor.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const access = await getProjectAccess(userId, idOrResp);
  if (!access) return jsonError("Project not found", 404);
  const data = await readJsonBody(req, AgentFiling);
  if (data instanceof NextResponse) return data;

  // The filing itself (rate limit, idempotent replay, insert, the owner's
  // opt-in build) is lib/feedback/agent-filing: one body for every door.
  const filed = await fileAgentFeedback(userId, idOrResp, access, data);
  if (!filed.ok) return jsonError(filed.error, filed.status);
  return jsonOk(filed.body, { status: filed.status });
}
