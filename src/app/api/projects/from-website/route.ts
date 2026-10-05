import { NextRequest, NextResponse, after } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { WebsiteBuildBody, websiteBuildBrief, websiteProjectName } from "@/lib/website-brief";
import { createProject } from "@/db/queries/projects";
import { findProjectEntityByName } from "@/db/queries/project-merge";
import { scheduleProjectProfileReindexByEntityId } from "@/lib/rag/reindex-project-profile";
import { SOURCE_LOKI_UI } from "@/lib/constants";
import { startServerKickoff, getServerKickoff } from "@/lib/kickoff/server-runs";
import { KICKOFF_STEPS } from "@/lib/project-kickoff";
import { checkRateLimit } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";

/** The existing project + kickoff pipeline, with the website as its brief.
 *  Repeated delivery of one request resumes its project, never another repo. */
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
  const name = websiteProjectName(input.website, input.requestId, input.mode);
  const source = websiteBuildBrief(input);
  let project = await findProjectEntityByName(userId, name);
  const existing = Boolean(project);
  if (!project) {
    try {
      const created = await createProject(userId, { name, description: source }, SOURCE_LOKI_UI);
      project = await findProjectEntityByName(userId, created.name);
      scheduleProjectProfileReindexByEntityId(userId, created.id);
    } catch (error) {
      // A second tab may have won the insert; only join this user's exact name.
      project = await findProjectEntityByName(userId, name);
      if (!project) throw error;
    }
  }
  if (!project)
    return NextResponse.json({ error: "The project was not saved. Try again." }, { status: 500 });
  // A retry of an accepted start must not put a second agent on a completed
  // project. The dossier already carries its progress and next action.
  if (!existing && !getServerKickoff(userId, project.id)) {
    const { done } = startServerKickoff(userId, {
      projectId: project.id,
      names: [project.name],
      plan: [...KICKOFF_STEPS],
      source,
      visibility: "private",
    });
    after(() => done);
  }
  return NextResponse.json({ ok: true, projectPath: `/projects/${project.id}/watch` });
}
