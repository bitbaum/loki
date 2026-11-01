import { denyDemoInHandler } from "@/lib/demo-guard";
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { getProjectCore } from "@/db/queries/projects";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import {
  latestSiteReview,
  publicReview,
  reviewTokenHash,
  updateSiteReview,
} from "@/db/queries/site-reviews";
import {
  REVIEW_MODES,
  ReviewStart,
  REVIEW_LIMITS,
  reviewIsActive,
  reviewUrl,
} from "@/lib/inspection/contract";
import { inspectionPrompt } from "@/lib/inspection/prompt";
import { normalizeWebsite } from "@/lib/website-brief";
import { injectPrompt } from "@/lib/inject-core";
import { appUrl } from "@/lib/email";
import { db } from "@/db";
import { siteReviews } from "@/db/schema/site-reviews";
import { checkRateLimit } from "@/lib/rate-limit";

type Context = { params: Promise<{ id: string }> };
export async function GET(_req: NextRequest, ctx: Context) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const id = await readIdParam(ctx.params);
  if (id instanceof NextResponse) return id;
  if (!(await getProjectCore(userId, id))) return jsonError("Not found", 404);
  const row = await latestSiteReview(userId, id);
  return jsonOk(
    { review: row ? publicReview(row) : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(req: NextRequest, ctx: Context) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const demoDenied = await denyDemoInHandler(userId, "dispatch");
  if (demoDenied) return demoDenied;
  const id = await readIdParam(ctx.params);
  if (id instanceof NextResponse) return id;
  const body = await readJsonBody(req, ReviewStart);
  if (body instanceof NextResponse) return body;
  const project = await getProjectCore(userId, id);
  if (!project) return jsonError("Not found", 404);
  if (!checkRateLimit(`site-review:${userId}`, 10, 3600000))
    return jsonError("Wait a little before starting another review.", 429);
  const previous = await latestSiteReview(userId, id);
  if (
    previous &&
    reviewIsActive(previous.status) &&
    Date.now() - previous.createdAt.getTime() >= REVIEW_LIMITS.lifetimeMs
  )
    await updateSiteReview(previous, { status: "failed" });
  else if (previous && reviewIsActive(previous.status))
    return jsonError(
      "A review is already open. Resume it or end it before starting another.",
      409,
      { reviewId: previous.id },
    );
  const registered = await getUserProjectByEntityId(userId, id);
  const url = registered?.liveUrl ?? "";
  if (body.mode !== "code" && (!normalizeWebsite(url) || !reviewUrl(url, url)))
    return jsonError("Add a working website address in project settings first.", 400);
  if (body.mode === "code" && !registered?.gitUrl && !project.gitUrl && !registered?.dirPath)
    return jsonError("Connect the project's code in Settings first.", 400);
  const token = randomBytes(32).toString("base64url");
  const [row] = await db
    .insert(siteReviews)
    .values({
      userId,
      projectId: id,
      mode: body.mode,
      url,
      paths: body.paths,
      tokenHash: reviewTokenHash(token),
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return jsonError("A review was just started. Refresh to open it.", 409);
  try {
    const origin = appUrl().replace(/\/$/, "");
    const result = await injectPrompt(
      {
        tab: registered?.name ?? project.name,
        customPrompt: inspectionPrompt({
          mode: body.mode,
          endpoint: `${origin}/api/reviews/${row.id}/worker`,
          token,
          source: `${origin}/inspection-worker.mjs`,
        }),
        displayPrompt: `Review ${project.name}: ${REVIEW_MODES[body.mode].label}. Watch pages, discuss findings and choose fixes in the project review workspace. Review only; do not change the site.`,
        notifyOnClose: true,
      },
      userId,
    );
    if (result.status >= 400) {
      await updateSiteReview(row, { status: "failed" });
      return NextResponse.json(result.body, { status: result.status });
    }
    return jsonOk({ review: publicReview(row) });
  } catch (error) {
    await updateSiteReview(row, { status: "failed" });
    console.error("[site-review:start]", error instanceof Error ? error.message : error);
    return jsonError("The review could not reach the runner. Try again.", 503);
  }
}
