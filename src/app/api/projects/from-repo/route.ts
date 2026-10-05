import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { RepoBuildBody, repoBuildBrief, repoProjectName } from "@/lib/repo-brief";
import { startBriefProject } from "@/lib/kickoff/start-brief-project";
import { checkRateLimit } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";

/** "Make it yours": a project whose first task is importing an open-source
 *  repository and personalising it. Seeded bare, because it brings its own code. */
export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in to start building." }, { status: 401 });
  const parsed = RepoBuildBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check your brief." },
      { status: 400 },
    );
  if (!checkRateLimit(`repo-build:${userId}`, 10, RATE_LIMIT_WINDOW_LONG_MS)) {
    return NextResponse.json(
      { error: "Too many starts. Your brief is saved; try again shortly." },
      { status: 429 },
    );
  }
  const input = parsed.data;
  const started = await startBriefProject(userId, {
    name: repoProjectName(input.repo, input.requestId),
    source: repoBuildBrief(input),
    template: "bare",
  });
  if (!started)
    return NextResponse.json({ error: "The project was not saved. Try again." }, { status: 500 });
  return NextResponse.json({ ok: true, ...started });
}
