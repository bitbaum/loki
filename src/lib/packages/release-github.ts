/**
 * The GitHub calls releasing a package needs, behind one interface so
 * ./release.ts is tested with a fake — the same split as ./update-github.ts.
 *
 * Every read is answered null when GitHub does not answer, never as an empty
 * success: "no tags" and "could not read the tags" must not look alike.
 */
import { RELEASE_WORKFLOW_FILE, TEMPLATE_SYNC_BRANCH } from "@/config/package-releases";
import { GITHUB_API_BASE } from "@/lib/github-api";
import type { RepoRef } from "@/lib/github-repo-ref";
import type { ReleaseCommit } from "./release-notes";
import { githubUpdateClient, type WriteResult } from "./update-github";

const REQUEST_TIMEOUT_MS = 6_000;

export type RepoAccess = { canPush: boolean; defaultBranch: string };
export type RepoTag = { name: string; sha: string };
export type CompareResult = { total: number; commits: ReleaseCommit[] };
export type ReleaseRun = {
  /** GitHub's run status: queued, in_progress, completed… */
  status: string;
  conclusion: string | null;
  url: string;
  /** The run's display name — release.yml names it "Release vX.Y.Z". */
  title: string;
  createdAt: string | null;
};
/** `exists: false` = the repository has no release.yml. */
export type ReleaseRuns = { exists: boolean; runs: ReleaseRun[] };

export interface ReleaseGithub {
  /** Whether this token may push, and the default branch; null when unreadable. */
  repoAccess(ref: RepoRef): Promise<RepoAccess | null>;
  /** Tags, as GitHub lists them; null when unreadable. */
  tags(ref: RepoRef): Promise<RepoTag[] | null>;
  /** Commits on `head` that `base` does not have, oldest first; null when unreadable. */
  compare(ref: RepoRef, base: string, head: string): Promise<CompareResult | null>;
  /** The head commit of a branch; null when unreadable. */
  branchHead(ref: RepoRef, branch: string): Promise<string | null>;
  /** Check conclusions on a commit (null = still running); null when unreadable. */
  checkConclusions(ref: RepoRef, sha: string): Promise<(string | null)[] | null>;
  /** The latest runs of release.yml; null when unreadable. */
  releaseRuns(ref: RepoRef): Promise<ReleaseRuns | null>;
  /** The open pull request from bitbaum/fleet's template sync, if any. */
  templateSyncPull(ref: RepoRef): Promise<{ number: number; url: string } | null>;
  /** Start release.yml on `branch` with these inputs. */
  dispatchRelease(
    ref: RepoRef,
    branch: string,
    inputs: { bump: string; version: string },
  ): Promise<WriteResult>;
}

/** GitHub's compare JSON → the commits Loki reads. Pure; exported for the test. */
export function readCompare(raw: unknown): CompareResult | null {
  const j = raw as { total_commits?: unknown; commits?: unknown } | null;
  if (!j || typeof j.total_commits !== "number" || !Array.isArray(j.commits)) return null;
  const commits = j.commits.flatMap((c): ReleaseCommit[] => {
    const r = c as { sha?: unknown; html_url?: unknown; commit?: { message?: unknown } } | null;
    if (typeof r?.sha !== "string" || typeof r.commit?.message !== "string") return [];
    return [
      {
        sha: r.sha,
        message: r.commit.message,
        url: typeof r.html_url === "string" ? r.html_url : null,
      },
    ];
  });
  return { total: j.total_commits, commits };
}

/** GitHub's workflow-runs JSON → the runs Loki reads. Pure; exported for the test. */
export function readRuns(raw: unknown): ReleaseRun[] {
  const j = raw as { workflow_runs?: unknown } | null;
  if (!j || !Array.isArray(j.workflow_runs)) return [];
  return j.workflow_runs.flatMap((r): ReleaseRun[] => {
    const run = r as Record<string, unknown> | null;
    if (!run || typeof run.html_url !== "string" || typeof run.status !== "string") return [];
    return [
      {
        status: run.status,
        conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
        url: run.html_url,
        title:
          typeof run.display_title === "string"
            ? run.display_title
            : typeof run.name === "string"
              ? run.name
              : "",
        createdAt: typeof run.created_at === "string" ? run.created_at : null,
      },
    ];
  });
}

/** The real client. `token` null reads public repositories and starts nothing. */
export function githubReleaseClient(token: string | null): ReleaseGithub {
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  });
  const get = (url: string) =>
    fetch(url, {
      headers: headers(),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch(() => null);
  const json = async (url: string): Promise<unknown> => {
    const res = await get(url);
    return res?.ok ? res.json().catch(() => null) : null;
  };
  const repo = (ref: RepoRef) => `${GITHUB_API_BASE}/repos/${ref.owner}/${ref.repo}`;
  const workflow = (ref: RepoRef) => `${repo(ref)}/actions/workflows/${RELEASE_WORKFLOW_FILE}`;

  return {
    async repoAccess(ref) {
      const j = (await json(repo(ref))) as {
        default_branch?: unknown;
        permissions?: { push?: unknown };
      } | null;
      if (!j || typeof j.default_branch !== "string") return null;
      return { canPush: j.permissions?.push === true, defaultBranch: j.default_branch };
    },

    async tags(ref) {
      const rows = await json(`${repo(ref)}/tags?per_page=100`);
      if (!Array.isArray(rows)) return null;
      return rows.flatMap((r) => {
        const t = r as { name?: unknown; commit?: { sha?: unknown } };
        return typeof t.name === "string" && typeof t.commit?.sha === "string"
          ? [{ name: t.name, sha: t.commit.sha }]
          : [];
      });
    },

    async compare(ref, base, head) {
      const basehead = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
      return readCompare(await json(`${repo(ref)}/compare/${basehead}`));
    },

    async branchHead(ref, branch) {
      const j = (await json(`${repo(ref)}/branches/${encodeURIComponent(branch)}`)) as {
        commit?: { sha?: unknown };
      } | null;
      return typeof j?.commit?.sha === "string" ? j.commit.sha : null;
    },

    checkConclusions: (ref, sha) => githubUpdateClient(token).checkConclusions(ref, sha),

    async releaseRuns(ref) {
      const res = await get(`${workflow(ref)}/runs?per_page=5`);
      if (res?.status === 404) return { exists: false, runs: [] };
      if (!res?.ok) return null;
      return { exists: true, runs: readRuns(await res.json().catch(() => null)) };
    },

    async templateSyncPull(ref) {
      const head = `${ref.owner}:${TEMPLATE_SYNC_BRANCH}`;
      const rows = await json(`${repo(ref)}/pulls?state=open&head=${encodeURIComponent(head)}`);
      const first = Array.isArray(rows)
        ? (rows[0] as { number?: unknown; html_url?: unknown } | undefined)
        : undefined;
      return typeof first?.number === "number" && typeof first.html_url === "string"
        ? { number: first.number, url: first.html_url }
        : null;
    },

    async dispatchRelease(ref, branch, inputs) {
      if (!token) return { ok: false, status: 0, message: "no GitHub token" };
      try {
        const res = await fetch(`${workflow(ref)}/dispatches`, {
          method: "POST",
          headers: headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ ref: branch, inputs }),
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (res.ok) return { ok: true };
        const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
        return {
          ok: false,
          status: res.status,
          message:
            typeof body?.message === "string" ? body.message.slice(0, 200) : `HTTP ${res.status}`,
        };
      } catch (err) {
        return { ok: false, status: 0, message: err instanceof Error ? err.message : "failed" };
      }
    },
  };
}
