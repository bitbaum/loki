/**
 * The newest released version of each fleet package.
 *
 * An npm package asks the npm registry (`/<name>/latest`). A package the
 * register installs from git asks GitHub for the repository's tags and takes
 * the highest semver one. Either answer is cached for 15 minutes (a failure
 * for 2), every request has a short timeout, and the whole lookup has a
 * deadline: a page renders with whatever answered in time, and the register's
 * own recorded version stands in for anything that did not — labelled as such,
 * so nobody mistakes it for a fresh answer.
 */
import { GITHUB_API_BASE } from "@/lib/github-api";
import { getOrgGithubToken } from "@/lib/github-org-token";
import type { CataloguePackage } from "./catalogue-parse";
import { highestSemverTag, parseSemver } from "./status";

export type LatestVersion = {
  version: string | null;
  /** Where the answer came from. `register` = the catalogue's own record, not a fresh look. */
  from: "npm" | "github" | "register" | "none";
};

const NPM_REGISTRY = "https://registry.npmjs.org";
const REQUEST_TIMEOUT_MS = 3_000;
/** The page never waits longer than this for the lookups as a whole. */
const PAGE_DEADLINE_MS = 2_500;
const CACHE_TTL_MS = 15 * 60_000;
const FAILURE_TTL_MS = 2 * 60_000;

const cache = new Map<string, { value: string | null; expiresAt: number }>();
const inflight = new Map<string, Promise<string | null>>();

/** For tests. */
export function resetLatestVersionCache(): void {
  cache.clear();
  inflight.clear();
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** `@bitbaum/ai-kit` → `@bitbaum%2Fai-kit`, the registry's path form. */
export function npmLatestUrl(name: string): string {
  return `${NPM_REGISTRY}/${encodeURIComponent(name).replace(/^%40/, "@")}/latest`;
}

async function fromNpm(name: string, fetchImpl: FetchLike): Promise<string | null> {
  const res = await fetchImpl(npmLatestUrl(name), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { version?: unknown };
  return typeof body.version === "string" && parseSemver(body.version) ? body.version : null;
}

async function fromGithubTags(repo: string, fetchImpl: FetchLike): Promise<string | null> {
  const token = getOrgGithubToken();
  const res = await fetchImpl(`${GITHUB_API_BASE}/repos/${repo}/tags?per_page=100`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ name?: unknown }>;
  if (!Array.isArray(rows)) return null;
  return highestSemverTag(rows.flatMap((r) => (typeof r.name === "string" ? [r.name] : [])));
}

function lookup(
  key: string,
  load: () => Promise<string | null>,
  now: number,
): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return Promise.resolve(hit.value);
  const running = inflight.get(key);
  if (running) return running;
  const job = load()
    .catch(() => null)
    .then((value) => {
      cache.set(key, { value, expiresAt: now + (value ? CACHE_TTL_MS : FAILURE_TTL_MS) });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** The fresh-lookup key for a package, or null when it has no source to ask. */
function lookupFor(
  pkg: CataloguePackage,
  fetchImpl: FetchLike,
): { key: string; load: () => Promise<string | null>; from: "npm" | "github" } | null {
  if (pkg.installSource === "git" && pkg.repo) {
    return {
      key: `gh:${pkg.repo}`,
      load: () => fromGithubTags(pkg.repo!, fetchImpl),
      from: "github",
    };
  }
  if (pkg.installSource !== "git") {
    return { key: `npm:${pkg.name}`, load: () => fromNpm(pkg.name, fetchImpl), from: "npm" };
  }
  return null;
}

/**
 * Latest versions for a set of packages, keyed by package name. Never throws
 * and never takes longer than the page deadline.
 */
export async function getLatestVersions(
  packages: readonly CataloguePackage[],
  opts: { fetchImpl?: FetchLike; deadlineMs?: number; now?: number } = {},
): Promise<Map<string, LatestVersion>> {
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = opts.now ?? Date.now();
  const answers = new Map<string, LatestVersion>();
  const jobs = packages.map(async (pkg) => {
    const source = lookupFor(pkg, fetchImpl);
    if (!source) return;
    const version = await lookup(source.key, source.load, now);
    if (version) answers.set(pkg.name, { version, from: source.from });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(jobs),
    new Promise((resolve) => {
      timer = setTimeout(resolve, opts.deadlineMs ?? PAGE_DEADLINE_MS);
    }),
  ]);
  clearTimeout(timer);
  const out = new Map<string, LatestVersion>();
  for (const pkg of packages) {
    out.set(
      pkg.name,
      answers.get(pkg.name) ??
        (pkg.registerVersion
          ? { version: pkg.registerVersion.replace(/^v/, ""), from: "register" }
          : { version: null, from: "none" }),
    );
  }
  return out;
}
