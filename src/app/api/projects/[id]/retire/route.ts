/**
 * POST /api/projects/[id]/retire — take a project's SITE down.
 *
 * Distinct from DELETE /api/projects/[id], which removes the Loki
 * project and (optionally) its repository. That route never touched the box,
 * so deleting a project left its website serving to the whole internet on a
 * wildcard DNS record, with a certificate, an enabled systemd unit, and a port
 * nobody could reclaim. This is the missing half.
 *
 * Two-step by construction: without `confirm: true` the runner executes the
 * teardown script in PLAN mode, which performs no action and returns exactly
 * what it would touch. The confirmation a person sees is therefore produced by
 * the code that acts, not by a second description of it that can drift.
 *
 * The box work is queued for the hosted runner (same path as site creation);
 * the repository half runs here, where the GitHub token lives.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/session";
import { readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { getCommandById } from "@/db/queries/pending-commands";
import { getProjectCore } from "@/db/queries/projects";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import { getRepoWriteToken, lokiKeepsCode } from "@/lib/github-org-token";
import { deprovisionGithubRepo, repoSlug, setGithubRepoVisibility } from "@/lib/github-provision";
import { requestRetireSite } from "@/lib/hosted-runner/provision";
import { RETIRE_MODES, REPO_ACTIONS, defaultRepoAction } from "@/lib/hosted-runner/retire-site";

const Body = z.object({
  mode: z.enum(RETIRE_MODES),
  repo: z.enum(REPO_ACTIONS).optional(),
  /** A live client engagement needs a second, explicit hand. */
  forceClient: z.boolean().optional(),
  /** Without this it is a plan and nothing happens. */
  confirm: z.boolean().optional(),
});

/**
 * Which site this project is. The live URL is authoritative when we have one —
 * it is what the box actually serves; the repo slug is the fallback, and it is
 * how the site was named at creation.
 */
function siteSlugFor(project: { name: string }, liveUrl: string | null): string {
  if (liveUrl) {
    try {
      return new URL(liveUrl).hostname.split(".")[0];
    } catch {
      /* fall through to the name */
    }
  }
  return repoSlug(project.name);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const project = await getProjectCore(userId, idOrResp);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const userProject = await getUserProjectByEntityId(userId, idOrResp).catch(() => null);

  const mode = dataOrResp.mode;
  const repoAction = dataOrResp.repo ?? defaultRepoAction(mode);
  const confirm = dataOrResp.confirm === true;
  const slug = siteSlugFor(project, userProject?.liveUrl ?? null);

  // The box half: queued, because a teardown stops services and reloads Caddy
  // and takes longer than a request should be held open.
  const queued = await requestRetireSite(
    userId,
    { slug, mode, repo: repoAction, forceClient: dataOrResp.forceClient === true },
    { confirm },
  );
  if (!queued.ok) {
    return NextResponse.json({ error: queued.error }, { status: queued.status });
  }

  // The repository half: done here, where the token is. Only on confirm — a
  // plan must not change anything, and making a repo private is a change.
  const gitUrl = project.gitUrl ?? userProject?.gitUrl ?? null;
  let repoResult: { attempted: boolean; ok: boolean; error?: string } = {
    attempted: false,
    ok: true,
  };
  if (confirm && repoAction !== "keep" && gitUrl) {
    const write = await getRepoWriteToken(userId, {
      lokiKept: lokiKeepsCode({ gitUrl, codeCustody: userProject?.codeCustody ?? null }),
    });
    if (!write) {
      repoResult = {
        attempted: true,
        ok: false,
        error: "Only your own GitHub account can change this repository. Connect it first.",
      };
    } else {
      const gh =
        repoAction === "private"
          ? await setGithubRepoVisibility(write.token, gitUrl, "private")
          : await deprovisionGithubRepo(write.token, gitUrl, repoAction);
      repoResult = gh.ok
        ? { attempted: true, ok: true }
        : { attempted: true, ok: false, error: gh.error };
    }
  }

  // A plan is worth nothing if the person has to go and look for it. The
  // script performs no action in plan mode, so it finishes in about a second
  // once the runner picks it up — wait briefly and hand the answer back inline.
  // If the runner is asleep, say so honestly rather than pretending.
  let planText: string | null = null;
  if (!confirm) {
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const cmd = await getCommandById(queued.commandId).catch(() => null);
      const result = cmd?.result as { text?: string } | null | undefined;
      if (cmd?.executedAt && result?.text) {
        planText = result.text;
        break;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    plan: planText,
    // False here means "nothing has happened yet" — the client shows the plan
    // and asks again.
    confirmed: confirm,
    slug,
    mode,
    repo: repoAction,
    commandId: queued.commandId,
    repoResult,
  });
}
