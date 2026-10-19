import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { WebsiteBuildBody, websiteBuildBrief, websiteProjectName } from "@/lib/website-brief";
import { startBriefProject } from "@/lib/kickoff/start-brief-project";
import { startWebsitePreview } from "@/lib/previews/from-website";
import { checkRateLimit } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import { z } from "zod";
import { BUILD_REQUESTS } from "@/config/build-requests";
import { fileBuildRequest } from "@/db/queries/build-requests";
import { getDefaultUser } from "@/db/queries/users";
import { isFleetInfrastructureAllowed } from "@/lib/execution-access";
import { previewsRoot } from "@/lib/previews/root";
import { notifyBuildRequest } from "@/lib/build-requests/notify";

/** The instant preview the visitor saw, kept with their request. */
const Look = z.object({
  before: z.string().startsWith("data:image/jpeg;base64,").max(BUILD_REQUESTS.lookMaxChars),
  after: z.string().startsWith("data:image/jpeg;base64,").max(BUILD_REQUESTS.lookMaxChars),
  summary: z.string().max(BUILD_REQUESTS.summaryMax).nullable(),
});

/** A website brief becomes a private PREVIEW first (lib/previews/from-website):
 *  no repository until the person says yes. Where this server keeps no
 *  previews, the project + kickoff pipeline is the fallback. Repeated delivery
 *  of one request resumes its project, never a second one.
 *
 *  An account that may not use the fleet's builder (every account but the
 *  operator's, today) files a build request instead of meeting a 403: the
 *  operator approves it on /approvals (config/build-requests). */
export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in to start building." }, { status: 401 });
  const raw = (await req.json().catch(() => null)) as { look?: unknown } | null;
  const parsed = WebsiteBuildBody.safeParse(raw);
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check your brief." },
      { status: 400 },
    );
  if (!checkRateLimit(`website-build:${userId}`, 10, RATE_LIMIT_WINDOW_LONG_MS)) {
    return NextResponse.json(
      { error: "Too many starts. Your brief is saved; try again shortly." },
      { status: 429 },
    );
  }
  const input = parsed.data;
  if (previewsRoot() && !(await isFleetInfrastructureAllowed(userId))) {
    const operator = await getDefaultUser().catch(() => null);
    if (!operator)
      return NextResponse.json({ error: "Nobody can approve builds here yet." }, { status: 503 });
    const look = Look.safeParse(raw?.look);
    const { row, fresh } = await fileBuildRequest({
      userId,
      requestId: input.requestId,
      website: input.website,
      brief: input,
      look: look.success ? look.data : null,
    });
    if (fresh) void notifyBuildRequest(operator.id, row);
    return NextResponse.json({
      ok: true,
      projectPath: BUILD_REQUESTS.pagePath(row.id),
      previewUrl: null,
      accessCode: null,
    });
  }
  const preview = await startWebsitePreview(userId, input);
  if (preview && !preview.ok)
    return NextResponse.json({ error: preview.error }, { status: preview.status });
  if (preview) return NextResponse.json(preview);
  const started = await startBriefProject(userId, {
    name: websiteProjectName(input.website, input.mode),
    requestId: input.requestId,
    source: websiteBuildBrief(input),
  });
  if (!started)
    return NextResponse.json({ error: "The project was not saved. Try again." }, { status: 500 });
  return NextResponse.json({ ok: true, ...started });
}
