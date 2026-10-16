import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { WebsiteBuildBody, websiteBuildBrief, websiteProjectName } from "@/lib/website-brief";
import { startBriefProject } from "@/lib/kickoff/start-brief-project";
import { startWebsitePreview } from "@/lib/previews/from-website";
import { checkRateLimit } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";

/** A website brief becomes a private PREVIEW first (lib/previews/from-website):
 *  no repository until the person says yes. Where this server keeps no
 *  previews, the project + kickoff pipeline is the fallback. Repeated delivery
 *  of one request resumes its project, never a second one. */
export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in to start building." }, { status: 401 });
  const parsed = WebsiteBuildBody.safeParse(await req.json().catch(() => null));
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
