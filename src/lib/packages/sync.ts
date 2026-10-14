/**
 * Read what each of a person's projects is built from, straight from its
 * repository — nothing has to change in the project.
 *
 * For every project with a GitHub repository: ask for the head commit of the
 * default branch; if neither that commit nor the catalogue moved since the last
 * read, stop there (one cheap request). Otherwise read `package.json` and the
 * lockfile AT that commit, keep the dependencies that are fleet packages
 * (./manifest.ts), and replace the project's rows.
 *
 * Failure is per project and stays per project: a private repository Loki has
 * no token for, a deleted one, a GitHub hiccup — each is recorded on that
 * project's scan with a reason, its previous rows are kept ("could not look" is
 * not "uses nothing"), and the rest of the projects carry on.
 *
 * Which token reads which repository follows github-org-token.ts: the fleet
 * org's server token only where the person may use it (code Loki keeps, or an
 * entitled account), and only for repositories in that org; the person's own
 * GitHub token for everything else; no token at all for a public repository.
 *
 * After a good read, the project's open Dependabot pull requests are read and
 * its update setting applied (./updates.ts) with the SAME token — the labels
 * and merges that needs are writes, and a token that may read a repository on
 * someone's behalf is the one that may hold an update in it on their behalf.
 * `updatesOnly` skips the package read for repositories read before, which is
 * what the 15-minute box timer uses: pull requests move faster than lockfiles.
 */
import { GITHUB_API_BASE } from "@/lib/github-api";
import { GITHUB_REPO_OWNER } from "@/config/github-owner";
import { parseGithubRepo, type RepoRef } from "@/lib/github-repo-ref";
import { getOrgGithubToken, lokiKeepsCode, mayUseOrgToken } from "@/lib/github-org-token";
import { getGithubToken } from "@/lib/github-token";
import { isFleetInfrastructureAllowed } from "@/lib/execution-access";
import { getUserProjects } from "@/db/queries/user-projects";
import {
  clearProjectPackages,
  listPackageScans,
  recordPackageScanFailure,
  replaceProjectPackages,
  touchPackageScan,
} from "@/db/queries/project-packages";
import { dbUpdateStore } from "@/db/queries/package-updates";
import { listReleasePauses } from "@/db/queries/package-releases";
import type { UserProject } from "@/db/schema";
import { getPackageCatalogue } from "./catalogue";
import type { CataloguePackage } from "./catalogue-parse";
import {
  catalogueKey,
  observePackages,
  parseNpmLock,
  parsePnpmLock,
  type LockInfo,
} from "./manifest";
import type { ReleasePause } from "./release-pause";
import { pickReadToken } from "./rules";
import { githubUpdateClient } from "./update-github";
import { syncProjectUpdates, type ProjectUpdatesResult } from "./updates";

/** How many repositories are read at once. */
const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 6_000;
/** A lockfile larger than this is not read; the versions are then unknown. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type ProjectSyncResult = {
  projectId: string;
  projectName: string;
  outcome: "updated" | "unchanged" | "no-repo" | "no-manifest" | "unreachable" | "error";
  packages?: number;
  detail?: string;
  /** The project's open update pull requests, after its setting was applied. */
  updates?: ProjectUpdatesResult;
};

export type SyncSummary = {
  results: ProjectSyncResult[];
  updated: number;
  unchanged: number;
  failed: number;
  catalogueSource: "live" | "snapshot";
};

class GithubReadError extends Error {
  readonly status: number;
  /** GitHub said the request budget is spent (403/429 with no requests remaining). */
  readonly rateLimited: boolean;
  constructor(res: Response) {
    super(`HTTP ${res.status}`);
    this.status = res.status;
    this.rateLimited =
      (res.status === 403 || res.status === 429) &&
      res.headers.get("x-ratelimit-remaining") === "0";
  }
}

async function ghGet(url: string, token: string | null, accept: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** The head commit of the default branch. */
async function headSha(ref: RepoRef, token: string | null): Promise<string> {
  const res = await ghGet(
    `${GITHUB_API_BASE}/repos/${ref.owner}/${ref.repo}/commits/HEAD`,
    token,
    "application/vnd.github.sha",
  );
  if (!res.ok) throw new GithubReadError(res);
  const sha = (await res.text()).trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error("GitHub answered without a commit sha");
  return sha;
}

/** One file at a commit, or null when it does not exist there. */
async function readFile(
  ref: RepoRef,
  path: string,
  sha: string,
  token: string | null,
): Promise<string | null> {
  const res = await ghGet(
    `${GITHUB_API_BASE}/repos/${ref.owner}/${ref.repo}/contents/${path}?ref=${sha}`,
    token,
    "application/vnd.github.raw",
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new GithubReadError(res);
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_FILE_BYTES) return null;
  const text = await res.text();
  return text.length > MAX_FILE_BYTES ? null : text;
}

async function readLock(ref: RepoRef, sha: string, token: string | null): Promise<LockInfo | null> {
  const pnpm = await readFile(ref, "pnpm-lock.yaml", sha, token);
  if (pnpm !== null) return parsePnpmLock(pnpm);
  const npm = await readFile(ref, "package-lock.json", sha, token);
  return npm !== null ? parseNpmLock(npm) : null;
}

/** A sentence the page can show for a failed read. */
function describeFailure(
  err: unknown,
  hadToken: boolean,
): {
  outcome: "unreachable" | "error";
  detail: string;
} {
  const status = err instanceof GithubReadError ? err.status : 0;
  if (err instanceof GithubReadError && err.rateLimited) {
    return {
      outcome: "error",
      detail: "GitHub's request limit for the hour was reached; the next refresh reads it.",
    };
  }
  if (status === 404 || status === 403 || status === 401) {
    return {
      outcome: "unreachable",
      detail: hadToken
        ? "GitHub would not show this repository to Loki — it was moved, deleted, or the token cannot see it."
        : "The repository is private or gone, and no GitHub token is connected to read it.",
    };
  }
  if (status === 409) return { outcome: "unreachable", detail: "The repository is empty." };
  const timedOut = err instanceof Error && err.name === "TimeoutError";
  return {
    outcome: "error",
    detail: timedOut ? "GitHub did not answer in time." : "GitHub answered with an error.",
  };
}

type SyncContext = {
  userId: string;
  catalogue: readonly CataloguePackage[];
  catalogueKey: string;
  previous: Map<string, { commitSha: string | null; catalogueKey: string | null; outcome: string }>;
  tokenFor: (ref: RepoRef) => string | null;
  force: boolean;
  updatesOnly: boolean;
  /** Releases paused by their package's owner — they hold updates in every project. */
  pauses: readonly ReleasePause[];
};

async function syncOne(project: UserProject, ctx: SyncContext): Promise<ProjectSyncResult> {
  const ref = parseGithubRepo(project.gitUrl);
  if (!ref) return { projectId: project.id, projectName: project.name, outcome: "no-repo" };
  const prev = ctx.previous.get(project.id);
  const readBefore = prev?.outcome === "ok";
  const result =
    ctx.updatesOnly && readBefore && !ctx.force
      ? { projectId: project.id, projectName: project.name, outcome: "unchanged" as const }
      : await readPackages(project, ref, ctx);
  if (result.outcome !== "updated" && result.outcome !== "unchanged") return result;
  const updates = await syncProjectUpdates({
    userId: ctx.userId,
    project,
    ref,
    catalogueNames: new Set(ctx.catalogue.map((pkg) => pkg.name)),
    gh: githubUpdateClient(ctx.tokenFor(ref)),
    store: dbUpdateStore,
    now: new Date(),
    pauses: ctx.pauses,
  }).catch((err): ProjectUpdatesResult => ({
    open: 0,
    held: 0,
    error: err instanceof Error ? err.message.slice(0, 200) : "failed",
  }));
  return { ...result, updates };
}

/** Phase 1: what the repository is built from, at its default branch's head. */
async function readPackages(
  project: UserProject,
  ref: RepoRef,
  ctx: SyncContext,
): Promise<ProjectSyncResult> {
  const base = { projectId: project.id, projectName: project.name };
  const token = ctx.tokenFor(ref);
  const scan = { userId: ctx.userId, projectId: project.id, catalogueKey: ctx.catalogueKey };
  let sha: string | null = null;
  try {
    sha = await headSha(ref, token);
    const prev = ctx.previous.get(project.id);
    if (
      !ctx.force &&
      prev &&
      prev.outcome !== "error" &&
      prev.outcome !== "unreachable" &&
      prev.commitSha === sha &&
      prev.catalogueKey === ctx.catalogueKey
    ) {
      await touchPackageScan(project.id);
      return { ...base, outcome: "unchanged" };
    }
    const manifest = await readFile(ref, "package.json", sha, token);
    if (manifest === null) {
      await clearProjectPackages({ ...scan, commitSha: sha, outcome: "no-manifest" });
      return { ...base, outcome: "no-manifest" };
    }
    const lock = await readLock(ref, sha, token).catch(() => null);
    const observed = observePackages(manifest, lock, ctx.catalogue);
    if (!observed) {
      const detail = "package.json could not be read as JSON.";
      await recordPackageScanFailure({ ...scan, commitSha: sha, outcome: "error", detail });
      return { ...base, outcome: "error", detail };
    }
    await replaceProjectPackages({ ...scan, commitSha: sha }, observed);
    return { ...base, outcome: "updated", packages: observed.length };
  } catch (err) {
    const failure = describeFailure(err, Boolean(token));
    await recordPackageScanFailure({ ...scan, commitSha: sha, ...failure }).catch(() => undefined);
    return { ...base, ...failure };
  }
}

async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

const inflight = new Map<string, Promise<SyncSummary>>();

/**
 * Read every active project of `userId` (or just `onlyProjectId`). Never
 * throws for a project's sake; one call per user runs at a time, and a second
 * caller shares the first's answer.
 */
export async function syncUserPackages(
  userId: string,
  opts: { onlyProjectId?: string; force?: boolean; updatesOnly?: boolean } = {},
): Promise<SyncSummary> {
  const key = `${userId}:${opts.onlyProjectId ?? "*"}:${opts.updatesOnly ? "u" : "f"}`;
  const running = inflight.get(key);
  if (running) return running;
  const job = runSync(userId, opts).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/**
 * The token for one of a person's repositories, read or write — see the module
 * comment. Resolved once per person, then asked per repository.
 */
export async function repoTokenPicker(
  userId: string,
): Promise<(project: Pick<UserProject, "gitUrl" | "codeCustody">, ref: RepoRef) => string | null> {
  const [userToken, entitled] = await Promise.all([
    getGithubToken(userId).catch(() => null),
    isFleetInfrastructureAllowed(userId).catch(() => false),
  ]);
  const orgToken = getOrgGithubToken();
  return (project, ref) =>
    pickReadToken({
      repoOwner: ref.owner,
      orgOwner: GITHUB_REPO_OWNER,
      orgToken,
      orgAllowed: mayUseOrgToken(entitled, { lokiKept: lokiKeepsCode(project) }),
      userToken,
    });
}

async function runSync(
  userId: string,
  opts: { onlyProjectId?: string; force?: boolean; updatesOnly?: boolean },
): Promise<SyncSummary> {
  const [catalogue, projects, scans, tokenFor, pauses] = await Promise.all([
    getPackageCatalogue(),
    getUserProjects(userId),
    listPackageScans(userId),
    repoTokenPicker(userId),
    // Unreadable pauses must not stop the sync; they are re-read every 15 minutes.
    listReleasePauses().catch((): ReleasePause[] => []),
  ]);
  const targets = opts.onlyProjectId
    ? projects.filter((p) => p.id === opts.onlyProjectId)
    : projects;
  const ctx: SyncContext = {
    userId,
    catalogue: catalogue.packages,
    catalogueKey: catalogueKey(catalogue.packages),
    previous: new Map(scans.map((s) => [s.projectId, s])),
    force: opts.force === true,
    updatesOnly: opts.updatesOnly === true,
    tokenFor: () => null,
    pauses,
  };
  const results = await mapWithLimit(targets, CONCURRENCY, (project) =>
    syncOne(project, { ...ctx, tokenFor: (ref) => tokenFor(project, ref) }).catch(
      (err): ProjectSyncResult => ({
        projectId: project.id,
        projectName: project.name,
        outcome: "error",
        detail: err instanceof Error ? err.message.slice(0, 200) : "failed",
      }),
    ),
  );
  return {
    results,
    updated: results.filter((r) => r.outcome === "updated" || r.outcome === "no-manifest").length,
    unchanged: results.filter((r) => r.outcome === "unchanged").length,
    failed: results.filter((r) => r.outcome === "unreachable" || r.outcome === "error").length,
    catalogueSource: catalogue.source,
  };
}
