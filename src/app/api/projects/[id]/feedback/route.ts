import { NextRequest, NextResponse } from "next/server";
import { readIdParam, readJsonBody, jsonOk, jsonError, z } from "@/lib/api/route-helpers";
import { getApiUserId, getSessionUserId } from "@/lib/session";
import {
  findFeedbackByIdempotencyKey,
  getFeedbackLoopMetrics,
  insertAgentFeedback,
  insertSiteFeedback,
  listProjectFeedback,
} from "@/db/queries/site-feedback";
import { FEEDBACK_SOURCE } from "@/lib/constants/statuses";
import { feedbackContentHash } from "@/lib/feedback/content-hash";
import { notifyFeedbackReceived } from "@/lib/feedback/notify-new";
import { watchFixPath } from "@/lib/feedback/tour-token";
import { appUrl } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
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

const AgentFiling = z.object({
  suggestion: z.string().trim().min(1).max(2000),
  /** What the agent calls itself ("qa-bot"): a label for the inbox, not an identity. */
  agentName: z.string().trim().min(1).max(80),
  /** The caller's retry key. The same key again returns the same row. */
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  page: z.string().max(300).optional(),
  url: z.string().max(1000).optional(),
  pageTitle: z.string().max(300).optional(),
});

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
  if (!checkRateLimit(`feedback:agent:${userId}:${idOrResp}`, 60, RATE_LIMIT_WINDOW_LONG_MS))
    return jsonError("Too many submissions, try again later", 429);
  const data = await readJsonBody(req, AgentFiling);
  if (data instanceof NextResponse) return data;

  const respond = (row: { id: string; status: string }, replayed: boolean) =>
    jsonOk(
      { id: row.id, status: row.status, statusUrl: `${appUrl()}${watchFixPath(row.id)}`, replayed },
      { status: replayed ? 200 : 201 },
    );

  if (data.idempotencyKey) {
    const seen = await findFeedbackByIdempotencyKey(idOrResp, data.idempotencyKey);
    if (seen) return respond(seen, true);
  }
  const values = {
    projectId: idOrResp,
    userId: access.ownerUserId,
    suggestion: data.suggestion,
    page: data.page ?? null,
    url: data.url ?? null,
    pageTitle: data.pageTitle ?? null,
    source: FEEDBACK_SOURCE.AGENT,
    agentName: data.agentName,
    reporterUserId: userId,
    contentHash: feedbackContentHash(data.suggestion, data.page ?? null),
  };
  // Without a key there is nothing to replay: a plain insert.
  const stored = data.idempotencyKey
    ? await insertAgentFeedback({ ...values, idempotencyKey: data.idempotencyKey })
    : await insertSiteFeedback(values).then((row) => (row ? { row, replayed: false } : null));
  if (!stored) return jsonError("Could not store feedback, try again later", 500);
  if (!stored.replayed) void notifyFeedbackReceived(stored.row);
  return respond(stored.row, stored.replayed);
}
