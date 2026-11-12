/**
 * Repo-side evidence that work happened during a run's window — the honesty
 * backstop for the stale-run reaper. Twice (PRs #118/#120, 2026-07-28) a box
 * agent did real work, never pushed a session handoff, and the run was stamped
 * `timeout` — the PR on origin was the only trace. Pull requests are checked
 * first (strongest signal, has a linkable URL), then repo events (a branch
 * push without a PR). Any failure degrades to null: evidence is a bonus,
 * never a blocker.
 *
 * The window alone is not an attribution: a pull request somebody else opened
 * while the run was live is not the run's. Only a pull request whose head
 * branch, or a push whose ref, is one of the run's own branches counts
 * (lib/run-branches).
 */

import { GITHUB_API_BASE } from "@/lib/github-api";
import { parseGithubRepo } from "@/lib/github-commits";
import type { RepoWorkEvidence } from "@/lib/repo-evidence";
import { refBelongsToRun } from "@/lib/run-branches";

export type { RepoWorkEvidence } from "@/lib/repo-evidence";
export { normalizeRepoWorkEvidence } from "@/lib/repo-evidence";

/** GitHub marks apps as `type: "Bot"`; the events feed only gives a login,
 *  which for an app ends in "[bot]". */
function isBot(who: { type?: string; login?: string } | null | undefined): boolean {
  return who?.type === "Bot" || /\[bot\]$/i.test(who?.login ?? "");
}

function ghInit(token: string): RequestInit {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
    // Evidence must be fresh — a cached miss would re-stamp a real run as dead.
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  };
}

export async function findRepoWorkEvidence(
  gitUrl: string,
  token: string,
  sinceMs: number,
  /** The run's own branches (runBranches). */
  branches: readonly string[],
  /** The end of the run's window (runEvidenceUntilMs); null while it runs. */
  untilMs: number | null = null,
): Promise<RepoWorkEvidence | null> {
  const parsed = parseGithubRepo(gitUrl);
  if (!parsed) return null;
  if (branches.length === 0) return null;
  const base = `${GITHUB_API_BASE}/repos/${parsed.owner}/${parsed.repo}`;
  const inWindow = (atMs: number) =>
    Number.isFinite(atMs) && atMs >= sinceMs && (untilMs === null || atMs <= untilMs);

  // Asked by head branch, one question per branch of the run. Scanning the
  // newest ten pull requests missed a run's own one in a busy repository
  // (loki opened eight in one morning).
  try {
    const perBranch = await Promise.all(
      branches.map(async (branch) => {
        const res = await fetch(
          `${base}/pulls?state=all&head=${encodeURIComponent(`${parsed.owner}:${branch}`)}&per_page=5`,
          ghInit(token),
        ).catch(() => null);
        if (!res?.ok) return [];
        const rows = (await res.json().catch(() => [])) as Array<{
          html_url?: string;
          title?: string;
          created_at?: string;
          user?: { type?: string; login?: string } | null;
          head?: { ref?: string | null } | null;
        }>;
        return (Array.isArray(rows) ? rows : []).map((row) => ({ row, branch }));
      }),
    );
    const own = perBranch
      .flat()
      .map(({ row, branch }) => ({
        row,
        branch,
        atMs: row.created_at ? Date.parse(row.created_at) : NaN,
      }))
      // GitHub filters by head already; the check stays so a mismatched
      // answer can never attribute somebody else's branch.
      .filter(({ row, atMs }) => inWindow(atMs) && refBelongsToRun(row.head?.ref, branches))
      // Dependabot opens pull requests on its own clock.
      .filter(({ row }) => !isBot(row.user) && row.html_url)
      .sort((a, b) => b.atMs - a.atMs);
    const pick = own[0];
    if (pick) {
      return {
        kind: "pr",
        url: pick.row.html_url!,
        title: pick.row.title ?? "pull request",
        atMs: pick.atMs,
        branch: pick.branch,
      };
    }
  } catch {
    // fall through to the events check
  }

  try {
    const res = await fetch(`${base}/events?per_page=30`, ghInit(token));
    if (res.ok) {
      const rows = (await res.json()) as Array<{
        type?: string;
        created_at?: string;
        payload?: { ref?: string | null };
        actor?: { login?: string } | null;
      }>;
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row.type !== "PushEvent" && row.type !== "CreateEvent") continue;
        if (isBot(row.actor)) continue;
        const atMs = row.created_at ? Date.parse(row.created_at) : NaN;
        if (Number.isFinite(atMs) && atMs < sinceMs) break; // events feed is newest-first
        if (!inWindow(atMs)) continue;
        const ref =
          typeof row.payload?.ref === "string"
            ? row.payload.ref.replace(/^refs\/heads\//, "")
            : null;
        if (!refBelongsToRun(ref, branches)) continue;
        return {
          kind: "push",
          url: `https://github.com/${parsed.owner}/${parsed.repo}${ref ? `/tree/${ref}` : ""}`,
          title: ref ? `push to ${ref}` : row.type,
          atMs,
          ...(ref ? { branch: ref } : {}),
        };
      }
    }
  } catch {
    // no evidence obtainable
  }

  return null;
}

/** A pull request's head branch, or null when GitHub cannot say. */
export async function fetchPrHeadRef(
  prUrl: string,
  token: string,
): Promise<string | null | undefined> {
  const m = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return undefined;
  try {
    const res = await fetch(
      `${GITHUB_API_BASE}/repos/${m[1]}/${m[2]}/pulls/${m[3]}`,
      ghInit(token),
    );
    if (!res.ok) return undefined;
    const row = (await res.json()) as { head?: { ref?: string | null } | null };
    return typeof row.head?.ref === "string" ? row.head.ref : null;
  } catch {
    return undefined;
  }
}
