import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { getRepoWriteToken } from "@/lib/github-org-token";
import { getProjectCore } from "@/db/queries/projects";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import { parseGithubRepoUrl } from "@/lib/github-provision";
import { checkProjectSiteDeployment } from "@/lib/site-cd-register";
import { RegisterCdBody, registerCdStep } from "@/lib/kickoff/steps";

/**
 * Register (or prepare) Hetzner CD for a project that already has a GitHub repo.
 *
 * Completes the cold-start hole after kickoff provision: repo without apps.conf /
 * deploy secret / live URL. Uses the same SSOT as new-site.sh via
 * scripts/hetzner/register-site.sh when this process is on the studio box;
 * otherwise seeds deploy.yml and returns the one command.
 */
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const dataOrResp = await readJsonBody(req, RegisterCdBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  // Logic lives in lib/kickoff/steps so the server-run kickoff calls exactly
  // the same code as this route.
  const { status, body } = await registerCdStep(userId, idOrResp, dataOrResp);
  return NextResponse.json(body, { status });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = await readIdParam(params);
  if (id instanceof NextResponse) return id;
  const project = await getProjectCore(userId, id);
  const up = await getUserProjectByEntityId(userId, id);
  if (!project || !up) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = project.gitUrl ? parseGithubRepoUrl(project.gitUrl) : null;
  const token = (await getRepoWriteToken(userId))?.token ?? null;
  if (!parsed || !token)
    return NextResponse.json(
      { error: "A linked GitHub repository and account are required." },
      { status: 400 },
    );
  const result = await checkProjectSiteDeployment({
    userId,
    entityProjectId: id,
    userProjectId: up.id,
    projectName: project.name,
    repoFullName: `${parsed.owner}/${parsed.repo}`,
    githubToken: token,
  });
  if (!("plan" in result)) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ ok: true, ...result, predictedLiveUrl: result.plan.liveUrl });
}
