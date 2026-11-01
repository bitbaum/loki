import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { readIdParam } from "@/lib/api/route-helpers";
import { getGithubToken } from "@/lib/github-token";
import { extractProjectProfile, applyProjectProfile } from "@/lib/project-brief";
import { getProjectCore } from "@/db/queries/projects";
import { fetchAttributesByEntityIds } from "@/db/queries/utils";
import { GITHUB_API_BASE } from "@/lib/github-api";
import { HTTP_TIMEOUT_SHORT_MS } from "@/lib/constants/time";
import { readAgentDocs } from "@/lib/agent-notes";

// Repo → profile. The project's own README (plus its agent notes, AGENTS.md first)
// already says what the project is — websites and repos hold the context,
// Loki profiles shouldn't be emptier than the repo. One click pulls
// the repo docs, the model fills description/mission/vision/customers/
// stack/status/next_step through the same path as the free-form brief.

const GITHUB_REPO_RE = /github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/i;

async function fetchRepoFile(
  owner: string,
  repo: string,
  path: string,
  token: string | null,
): Promise<string | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  // "readme" is GitHub's resolver endpoint (any README casing/extension);
  // other paths go through the contents API.
  const url =
    path === "readme"
      ? `${GITHUB_API_BASE}/repos/${owner}/${repo}/readme`
      : `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_SHORT_MS),
  }).catch(() => null);
  if (!res?.ok) return null;
  const text = await res.text().catch(() => null);
  return text?.trim() || null;
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const project = await getProjectCore(userId, idOrResp);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // entities.git_url wins; legacy attrs.repo / attrs.github_repo are the
  // fallback (same precedence as getProjectLinks in the project header).
  let repoRef = project.gitUrl;
  if (!repoRef) {
    const attrs = (await fetchAttributesByEntityIds([project.id])).get(project.id) ?? {};
    repoRef = attrs["repo"] ?? attrs["github_repo"] ?? null;
    if (repoRef && !repoRef.includes("github.com")) repoRef = `https://github.com/${repoRef}`;
  }

  const match = repoRef ? GITHUB_REPO_RE.exec(repoRef) : null;
  if (!match) {
    return NextResponse.json(
      {
        error:
          "No GitHub repository linked. Set the repo URL on the project first, or describe the project in your own words instead.",
      },
      { status: 422 },
    );
  }
  const [, owner, repo] = match;

  const token = await getGithubToken(userId);
  // AGENTS.md first; a CLAUDE.md that only points elsewhere is followed, not read.
  const [readme, agentDocs] = await Promise.all([
    fetchRepoFile(owner, repo, "readme", token),
    readAgentDocs((path) => fetchRepoFile(owner, repo, path, token)),
  ]);

  const source = [readme, ...agentDocs.map((d) => d.text)].filter(Boolean).join("\n\n---\n\n");
  if (!source) {
    return NextResponse.json(
      {
        error: `Could not read a README from ${owner}/${repo}. Is the repo private without a linked GitHub account?`,
      },
      { status: 422 },
    );
  }

  let profile;
  try {
    profile = await extractProjectProfile(project.name, source);
  } catch (e) {
    return NextResponse.json(
      {
        error: "Could not extract a profile from the repo docs. Try again in a moment.",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  const applied = await applyProjectProfile(userId, idOrResp, profile);
  if (applied === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (Object.keys(applied).length === 0) {
    return NextResponse.json(
      { error: "The repo docs didn't contain anything usable for the profile." },
      { status: 422 },
    );
  }
  return NextResponse.json({ ok: true, applied, source: `${owner}/${repo}` });
}
