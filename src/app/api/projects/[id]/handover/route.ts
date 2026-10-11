import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { readIdParam } from "@/lib/api/route-helpers";
import { getProjectCore, patchProject } from "@/db/queries/projects";
import { getUserProjectByEntityId, updateUserProject } from "@/db/queries/user-projects";
import { CODE_CUSTODY } from "@/db/schema/user-projects";
import { getGithubToken } from "@/lib/github-token";
import { getOrgGithubToken } from "@/lib/github-org-token";
import { githubLoginFor, repoUrlAfterTransfer, transferGithubRepo } from "@/lib/github-provision";

export const maxDuration = 60;

/**
 * POST /api/projects/[id]/handover — make the code the person's own.
 *
 * Loki keeps a project's code so nobody has to open a GitHub account to
 * start. This is the way out of that arrangement, offered once there is
 * something worth owning: the repository Loki created is transferred to the
 * person's own GitHub account, custody flips to "own", and from then on they
 * manage it there. No copy, no fork — one repository, now theirs, history and
 * all.
 *
 * Only a repository with custody "loki" can be handed over, and only by the
 * project's owner. A GitHub account is needed HERE, and only here: it is the
 * destination, and there is no other way to give someone a repository.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const project = await getProjectCore(userId, idOrResp);
  const up = await getUserProjectByEntityId(userId, idOrResp);
  if (!project || !up) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gitUrl = up.gitUrl ?? project.gitUrl;
  if (!gitUrl || up.codeCustody !== CODE_CUSTODY.LOKI) {
    return NextResponse.json(
      { error: "This project's code is not kept by Loki, so there is nothing to hand over." },
      { status: 400 },
    );
  }

  const userToken = await getGithubToken(userId);
  if (!userToken) {
    return NextResponse.json(
      { error: "Connect your GitHub account first — it is where the code goes.", hasGithub: false },
      { status: 400 },
    );
  }
  const login = await githubLoginFor(userToken);
  if (!login) {
    return NextResponse.json(
      {
        error: "GitHub did not say who you are. Reconnect GitHub and try again.",
        hasGithub: false,
      },
      { status: 400 },
    );
  }

  const orgToken = getOrgGithubToken();
  if (!orgToken) {
    return NextResponse.json(
      { error: "This server holds no credential for the code it keeps, so it cannot move it." },
      { status: 503 },
    );
  }

  const moved = await transferGithubRepo(orgToken, gitUrl, login);
  if (!moved.ok) {
    return NextResponse.json({ error: moved.error, detail: moved.detail }, { status: 502 });
  }

  const newUrl = repoUrlAfterTransfer(gitUrl, login) ?? gitUrl;
  await updateUserProject(up.id, userId, { gitUrl: newUrl, codeCustody: CODE_CUSTODY.OWN });
  await patchProject(userId, idOrResp, { gitUrl: newUrl });

  return NextResponse.json({ ok: true, gitUrl: newUrl, login, pendingAcceptance: true });
}
