/**
 * Ask GitHub what a running build has pushed so far (run-milestones.ts says it
 * in words). The chat card polls its status every few seconds; GitHub is asked
 * at most once a minute per run, and a failure of any kind is "nothing yet" —
 * progress is a bonus on the card, never a reason it fails to load.
 */
import { GITHUB_API_BASE } from "@/lib/github-api";
import { parseGithubRepo } from "@/lib/github-commits";
import { summarizeChecks, type RepoProgress } from "@/lib/run-milestones";

const FRESH_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<RepoProgress | null> }>();

function init(token: string): RequestInit {
  return {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  };
}

async function get<T>(url: string, token: string): Promise<T | null> {
  const res = await fetch(url, init(token)).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

type GhCommit = {
  sha: string;
  html_url: string;
  commit: { message: string; committer?: { date?: string }; author?: { date?: string } };
};

const toCommits = (rows: GhCommit[] | null, sinceMs: number) =>
  (Array.isArray(rows) ? rows : [])
    .map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      at: c.commit.committer?.date ?? c.commit.author?.date ?? "",
      url: c.html_url,
    }))
    .filter((c) => Date.parse(c.at) >= sinceMs)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

async function readRepoProgress(
  gitUrl: string,
  token: string,
  sinceMs: number,
): Promise<RepoProgress | null> {
  const parsed = parseGithubRepo(gitUrl);
  if (!parsed) return null;
  const base = `${GITHUB_API_BASE}/repos/${parsed.owner}/${parsed.repo}`;

  // A pull request opened since the run began is the strongest trail: its
  // branch is the work, its checks are the verdict.
  const pulls = await get<
    {
      number: number;
      title: string;
      html_url: string;
      created_at: string;
      head: { sha: string };
    }[]
  >(`${base}/pulls?state=all&sort=created&direction=desc&per_page=10`, token);
  const pr = (pulls ?? []).find((p) => Date.parse(p.created_at) >= sinceMs) ?? null;
  if (pr) {
    const [commits, checks] = await Promise.all([
      get<GhCommit[]>(`${base}/pulls/${pr.number}/commits?per_page=100`, token),
      get<{ check_runs: { status: string; conclusion: string | null }[] }>(
        `${base}/commits/${pr.head.sha}/check-runs?per_page=100`,
        token,
      ),
    ]);
    return {
      commits: toCommits(commits, sinceMs),
      pr: {
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        at: pr.created_at,
        checks: summarizeChecks(checks?.check_runs ?? []),
      },
    };
  }

  // No pull request yet: a branch pushed since the run began.
  const events = await get<{ type: string; created_at: string; payload?: { ref?: string } }[]>(
    `${base}/events?per_page=30`,
    token,
  );
  const push = (events ?? []).find(
    (e) => e.type === "PushEvent" && Date.parse(e.created_at) >= sinceMs && e.payload?.ref,
  );
  if (!push) return { commits: [], pr: null };
  const ref = push.payload!.ref!.replace(/^refs\/heads\//, "");
  const since = new Date(sinceMs).toISOString();
  const commits = await get<GhCommit[]>(
    `${base}/commits?sha=${encodeURIComponent(ref)}&since=${since}&per_page=30`,
    token,
  );
  return { commits: toCommits(commits, sinceMs), pr: null };
}

export function fetchRepoProgress(
  runId: string,
  gitUrl: string,
  token: string,
  sinceMs: number,
  now: number = Date.now(),
): Promise<RepoProgress | null> {
  const hit = cache.get(runId);
  if (hit && now - hit.at < FRESH_MS) return hit.value;
  const value = readRepoProgress(gitUrl, token, sinceMs).catch(() => null);
  cache.set(runId, { at: now, value });
  // Old runs fall out; the map never grows past the runs being watched.
  for (const [k, v] of cache) if (now - v.at > 10 * FRESH_MS) cache.delete(k);
  return value;
}
