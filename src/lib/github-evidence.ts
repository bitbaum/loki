/**
 * Repo-side evidence that work happened during a run's window — the honesty
 * backstop for the stale-run reaper. Twice (PRs #118/#120, 2026-07-28) a box
 * agent did real work, never pushed a session handoff, and the run was stamped
 * `timeout` — the PR on origin was the only trace. Pull requests are checked
 * first (strongest signal, has a linkable URL), then repo events (a branch
 * push without a PR). Any failure degrades to null: evidence is a bonus,
 * never a blocker.
 */

import { GITHUB_API_BASE } from "@/lib/github-api";
import { parseGithubRepo } from "@/lib/github-commits";
import type { RepoWorkEvidence } from "@/lib/repo-evidence";

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
): Promise<RepoWorkEvidence | null> {
  const parsed = parseGithubRepo(gitUrl);
  if (!parsed) return null;
  const base = `${GITHUB_API_BASE}/repos/${parsed.owner}/${parsed.repo}`;

  try {
    const res = await fetch(
      `${base}/pulls?state=all&sort=created&direction=desc&per_page=10`,
      ghInit(token),
    );
    if (res.ok) {
      const rows = (await res.json()) as Array<{
        html_url?: string;
        title?: string;
        created_at?: string;
        user?: { type?: string; login?: string } | null;
      }>;
      for (const row of Array.isArray(rows) ? rows : []) {
        const atMs = row.created_at ? Date.parse(row.created_at) : NaN;
        if (!Number.isFinite(atMs) || atMs < sinceMs) break; // sorted desc — older from here on
        // Dependabot opens pull requests on its own clock. One that lands in
        // the run's window is not the run's work, and telling the person
        // "Pull request opened: bump 24 packages" about their font-size
        // change is worse than saying nothing.
        if (isBot(row.user)) continue;
        if (row.html_url)
          return { kind: "pr", url: row.html_url, title: row.title ?? "pull request", atMs };
      }
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
        if (!Number.isFinite(atMs) || atMs < sinceMs) break; // events feed is newest-first
        const ref =
          typeof row.payload?.ref === "string"
            ? row.payload.ref.replace(/^refs\/heads\//, "")
            : null;
        return {
          kind: "push",
          url: `https://github.com/${parsed.owner}/${parsed.repo}${ref ? `/tree/${ref}` : ""}`,
          title: ref ? `push to ${ref}` : row.type,
          atMs,
        };
      }
    }
  } catch {
    // no evidence obtainable
  }

  return null;
}
