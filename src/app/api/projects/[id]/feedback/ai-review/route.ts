import { NextRequest, NextResponse } from "next/server";
import { readIdParam, readJsonBody, jsonError, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { getProjectCore } from "@/db/queries/projects";
import { getActiveWidgetToken } from "@/db/queries/widget-tokens";
import { injectPrompt } from "@/lib/inject-core";
import { composeReviewPrompt } from "@/lib/feedback/ai-review-prompt";

/**
 * "AI review this page": dispatch an agent to visually review a live page and
 * submit each finding through the same public widget API a human visitor uses
 * (POST /api/feedback with the project's fcw_ token). AI findings land in the
 * same inbox as human feedback and go through the same operator triage —
 * review never auto-dispatches fixes (docs/architecture/feedback-widget.md).
 */

const ReviewBody = z.object({
  url: z.string().url().max(1000),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const dataOrResp = await readJsonBody(req, ReviewBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const project = await getProjectCore(userId, idOrResp);
  if (!project) return jsonError("Project not found", 404);
  const token = await getActiveWidgetToken(userId, idOrResp);
  if (!token)
    return jsonError(
      "Enable the feedback widget first — the AI reviewer files its findings through the widget API",
      400,
    );

  const { status, body } = await injectPrompt(
    {
      tab: project.name,
      customPrompt: composeReviewPrompt(dataOrResp.url, project.name, token.token),
      notifyOnClose: true,
    },
    userId,
  );
  return NextResponse.json(body, { status });
}
