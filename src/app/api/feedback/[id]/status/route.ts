import { NextRequest, NextResponse } from "next/server";
import { readIdParam, jsonOk, jsonError } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { getFeedbackWithProject } from "@/db/queries/site-feedback";
import { getRunsByIdsForReporter } from "@/db/queries/orchestration-runs";
import { attachFeedbackWork, runToFeedbackSnapshot } from "@/lib/feedback/attach-work";
import { canonicalStatus } from "@/lib/feedback/canonical-status";
import { deriveFeedbackWork } from "@/lib/feedback/work-phase";
import { livePageHref } from "@/lib/feedback/fix-shipping";

/**
 * Where one report is, in the six canonical states (lib/feedback/
 * canonical-status.ts) — what an agent polls after POST /api/projects/[id]/
 * feedback returns its `statusUrl`. Bearer `ck_` token or session.
 *
 * Two shapes, by seat, never one with holes: an owner or editor gets the
 * whole status (state, cause, nextAction, evidence); anyone else gets the
 * state and label of a report THEY filed, and nothing of the machine
 * (reporter-view.ts keeps the same line). Anyone else's report is a 404.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const row = await getFeedbackWithProject(userId, idOrResp);
  if (!row) return jsonError("Feedback not found", 404);
  const { feedback } = row;
  const noStore = { headers: { "Cache-Control": "no-store" } };

  if (row.canEdit) {
    const { screenshots, ...rest } = feedback;
    const [item] = await attachFeedbackWork(row.ownerUserId, [
      {
        ...rest,
        hasScreenshots: Boolean(screenshots?.length),
        liveUrl: row.liveUrl,
        runnable: row.hasWorkspace,
      },
    ]);
    const status = canonicalStatus(item.work, {
      liveUrl: livePageHref(row.liveUrl, feedback.url, feedback.page),
    });
    return jsonOk({ id: feedback.id, source: feedback.source, ...status }, noStore);
  }

  if (feedback.reporterUserId !== userId) return jsonError("Feedback not found", 404);
  const run = feedback.dispatchedRunId
    ? (await getRunsByIdsForReporter([feedback.dispatchedRunId])).get(feedback.dispatchedRunId)
    : null;
  const { state, label } = canonicalStatus(
    deriveFeedbackWork(feedback.status, runToFeedbackSnapshot(run)),
  );
  return jsonOk({ id: feedback.id, source: feedback.source, state, label }, noStore);
}
