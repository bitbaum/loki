import { NextRequest, NextResponse } from "next/server";
import { readIdParam, readJsonBody, jsonError, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { getProjectCore } from "@/db/queries/projects";
import { listProjectFeedback, markFeedbackDispatchedBulk } from "@/db/queries/site-feedback";
import { injectPrompt } from "@/lib/inject-core";
import { FEEDBACK_SOURCE, FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { feedbackInjectAccepted } from "@/lib/feedback/dispatch-accept";
import { composeFeedbackBatchFixPrompt } from "@/lib/feedback/compose-dispatch";

/**
 * One-click "Implement all as one": collapse every NEW visitor/AI-review item
 * into a single injectPrompt for this project. Prefer this when N≥2 and you
 * want one agent pass; use Synthesize when N is large and you want theme
 * briefs back in the inbox first. Human gate preserved — nothing runs without
 * this POST.
 */

const Body = z.object({
  note: z.string().trim().max(500).optional(),
  /** Optional subset; default = all NEW non-synthesizer rows. */
  ids: z.array(z.string().uuid()).max(60).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const project = await getProjectCore(userId, idOrResp);
  if (!project) return jsonError("Project not found", 404);

  let items = (await listProjectFeedback(userId, idOrResp)).filter(
    (f) => f.status === FEEDBACK_STATUS.NEW && f.source !== FEEDBACK_SOURCE.SYNTHESIZER,
  );
  if (dataOrResp.ids?.length) {
    const want = new Set(dataOrResp.ids);
    items = items.filter((f) => want.has(f.id));
  }
  if (items.length === 0) return jsonError("No new feedback to dispatch", 400);
  if (items.length === 1) {
    return jsonError("Use Implement on the single row — batch is for 2+ items", 400);
  }

  const prompt = composeFeedbackBatchFixPrompt(items, project.name, dataOrResp.note || undefined);
  const { status, body } = await injectPrompt(
    {
      tab: project.name,
      projectId: idOrResp,
      allowHostedFallback: true,
      refuseOfflineQueue: true,
      // Honor user_projects.builder_pref via pickDispatchChannel — do not force cloud.
      customPrompt: prompt,
      notifyOnClose: true,
    },
    userId,
  );
  const accepted = feedbackInjectAccepted(status, body);
  if (accepted) {
    const runId = body.runId;
    await markFeedbackDispatchedBulk(
      userId,
      items.map((f) => f.id),
      runId,
    );
  }
  return NextResponse.json(
    { ...body, dispatchedCount: accepted ? items.length : 0 },
    { status: accepted || body.blocked ? status : status < 400 ? 502 : status },
  );
}
