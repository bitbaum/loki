/**
 * GET /api/control/workspace-source?tab=<project name> — what a builder needs
 * to materialize a project it does not have: the repository to clone and a
 * token that may write to it, for THIS account.
 *
 * The box-runner used to read `user_projects` itself, with the production
 * DATABASE_URL in its environment and the org GITHUB_TOKEN for every clone
 * and push — the same environment every agent PTY inherited. A runner now
 * asks here with its own runner token and gets only its own account's
 * projects and a token that account may use (github-org-token.ts: the org
 * token for a repository Loki keeps, else the person's own GitHub); the
 * runner passes that token to the one agent run that needs it, never into
 * its own environment (docs/architecture/private-builders.md).
 */
import { NextResponse } from "next/server";
import { z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { getOrgProjects } from "@/db/queries/user-projects";
import { getRepoWriteToken, lokiKeepsCode } from "@/lib/github-org-token";
import { normalizeGitHubCloneUrl } from "@/lib/git-url";

export const runtime = "nodejs";

const Tab = z.string().trim().min(1).max(120);

export async function GET(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tab = Tab.safeParse(new URL(req.url).searchParams.get("tab"));
  if (!tab.success) return NextResponse.json({ error: "tab required" }, { status: 400 });

  // The same set a dispatch resolves against (inject-core): this account's
  // projects and its org peers' — never a project the account merely has a
  // seat on.
  const projects = await getOrgProjects(userId);
  const project = projects.find((p) => p.name.toLowerCase() === tab.data.toLowerCase());
  if (!project) return NextResponse.json({ error: "Unknown project" }, { status: 404 });

  const gitUrl = project.gitUrl?.trim() ? normalizeGitHubCloneUrl(project.gitUrl.trim()) : null;
  const write = gitUrl
    ? await getRepoWriteToken(userId, { lokiKept: lokiKeepsCode(project) }).catch(() => null)
    : null;
  return NextResponse.json(
    { gitUrl, token: write?.token ?? null, tokenSource: write?.source ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
