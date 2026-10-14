/**
 * Releasing a package from Loki: what is unreleased, which version it makes,
 * whether a release can start now, and starting it.
 *
 * Loki starts the package repository's own release.yml (bitbaum/fleet
 * templates/package) with an exact version and reads back what happened —
 * the tag, the run. It never builds, tags or pushes anything itself, and it
 * stores nothing: every state shown is read from GitHub on the spot.
 *
 * Everything that touches GitHub comes in through `ReleaseGithub`, so this
 * module is tested with a fake (scripts/test/package-releases.ts).
 */
import { RELEASE_MESSAGES, type ReleaseBump } from "@/config/package-releases";
import type { RepoRef } from "@/lib/github-repo-ref";
import type { ReleaseGithub, ReleaseRun } from "./release-github";
import {
  commitKind,
  commitTitle,
  suggestRelease,
  type CommitKind,
  type ReleaseSuggestion,
} from "./release-notes";
import { compareSemver, highestSemverTag, parseSemver } from "./status";
import { ciStateFrom, type CiState } from "./update-policy";

// ── who may ─────────────────────────────────────────────────────────────────

export type AccessDecision =
  | { ok: true; via: "project" | "github" }
  | { ok: false; reason: string; connectGithub: boolean };

/**
 * The owner rule (src/config/package-releases.ts), with what was looked up.
 * Pure; ./release-access.ts does the looking.
 */
export function decideReleaseAccess(input: {
  hasRepo: boolean;
  /** Accounts owning an active project whose repository is the package's. */
  projectOwnerIds: readonly string[];
  viewerId: string;
  hasToken: boolean;
  /** What GitHub said about the token; null = it did not answer. */
  canPush: boolean | null;
}): AccessDecision {
  if (!input.hasRepo) return { ok: false, reason: RELEASE_MESSAGES.noRepo, connectGithub: false };
  const ownsProject = input.projectOwnerIds.includes(input.viewerId);
  if (input.projectOwnerIds.length > 0 && !ownsProject) {
    return { ok: false, reason: RELEASE_MESSAGES.notOwner, connectGithub: false };
  }
  if (!input.hasToken) {
    return { ok: false, reason: RELEASE_MESSAGES.connectGithub, connectGithub: true };
  }
  if (input.canPush === null) {
    return { ok: false, reason: RELEASE_MESSAGES.unreadable, connectGithub: false };
  }
  if (!input.canPush) {
    return { ok: false, reason: RELEASE_MESSAGES.cannotPush, connectGithub: true };
  }
  return { ok: true, via: ownsProject ? "project" : "github" };
}

// ── what there is to release ────────────────────────────────────────────────

export type UnreleasedChange = { sha: string; title: string; url: string | null; kind: CommitKind };

export type LastRelease = {
  /** The version the run was releasing (from its name, "Release v0.3.0"). */
  version: string | null;
  phase: "running" | "released" | "failed";
  url: string;
  startedAt: string | null;
  /** Its tag is already there. */
  tagged: boolean;
};

export type ReleaseState = {
  repo: string;
  defaultBranch: string;
  /** The latest released version (the highest version tag), without a `v`. */
  current: string | null;
  /** Changes on the default branch since that tag, newest first; null when unreadable. */
  unreleased: { total: number; changes: UnreleasedChange[] } | null;
  suggestion: ReleaseSuggestion | null;
  /** Does the repository have release.yml? */
  workflow: "present" | "missing" | "unknown";
  /** The fleet's pull request that adds it, when one is open. */
  syncPull: { number: number; url: string } | null;
  /** The checks on the default branch's latest commit. */
  main: CiState;
  lastRun: LastRelease | null;
};

const RUN_VERSION = /\bv(\d+\.\d+\.\d+)\b/;

/** The newest release run, in Loki's words. Pure; exported for the test. */
export function readLastRun(
  runs: readonly ReleaseRun[],
  current: string | null,
): LastRelease | null {
  const run = runs[0];
  if (!run) return null;
  const version = RUN_VERSION.exec(run.title)?.[1] ?? null;
  const phase =
    run.status !== "completed" ? "running" : run.conclusion === "success" ? "released" : "failed";
  const a = parseSemver(version);
  const b = parseSemver(current);
  return {
    version,
    phase,
    url: run.url,
    startedAt: run.createdAt,
    tagged: Boolean(a && b && compareSemver(b, a) >= 0),
  };
}

/** Read everything the release panel shows. Never throws. */
export async function readRelease(
  gh: ReleaseGithub,
  ref: RepoRef,
  defaultBranch: string,
  listLimit: number,
): Promise<ReleaseState> {
  const [tags, runs, head] = await Promise.all([
    gh.tags(ref),
    gh.releaseRuns(ref),
    gh.branchHead(ref, defaultBranch),
  ]);
  const current = tags ? highestSemverTag(tags.map((t) => t.name)) : null;
  const currentTag = current
    ? (tags!.find((t) => t.name.replace(/^v/, "") === current)?.name ?? null)
    : null;
  const [compared, checks, syncPull] = await Promise.all([
    currentTag ? gh.compare(ref, currentTag, defaultBranch) : Promise.resolve(null),
    head ? gh.checkConclusions(ref, head) : Promise.resolve(null),
    runs && !runs.exists ? gh.templateSyncPull(ref) : Promise.resolve(null),
  ]);
  const changes = compared
    ? [...compared.commits].reverse().map((c) => ({
        sha: c.sha,
        title: commitTitle(c.message),
        url: c.url,
        kind: commitKind(c.message),
      }))
    : [];
  return {
    repo: ref.slug,
    defaultBranch,
    current,
    unreleased: compared
      ? { total: compared.total, changes: changes.slice(0, listLimit) }
      : current
        ? null
        : { total: 0, changes: [] },
    suggestion: compared ? suggestRelease(current, compared.commits) : null,
    workflow: runs === null ? "unknown" : runs.exists ? "present" : "missing",
    syncPull,
    main: ciStateFrom(checks),
    lastRun: runs ? readLastRun(runs.runs, current) : null,
  };
}

/**
 * Why a release cannot start right now, in a sentence — or null when it can.
 * The order is the order a person would fix things in.
 */
export function releaseBlocker(state: ReleaseState): string | null {
  if (state.workflow === "missing") return RELEASE_MESSAGES.noWorkflow;
  if (state.workflow === "unknown") return RELEASE_MESSAGES.unreadable;
  if (state.lastRun?.phase === "running") return RELEASE_MESSAGES.running;
  if (!state.current) return RELEASE_MESSAGES.noTag;
  if (!state.unreleased) return RELEASE_MESSAGES.unreadable;
  if (!state.suggestion) return RELEASE_MESSAGES.nothingToRelease;
  if (state.main === "red") return RELEASE_MESSAGES.mainRed;
  if (state.main === "pending") return RELEASE_MESSAGES.mainRunning;
  if (state.main === "unknown") return RELEASE_MESSAGES.mainUnknown;
  return null;
}

export type StartResult =
  | { ok: true; message: string; version: string }
  | { ok: false; status: number; message: string };

/**
 * Start release.yml for exactly the version the person was shown. The state
 * is read again first: if the suggestion moved (a change landed, someone else
 * released), nothing starts and the person is asked to look again.
 */
export async function startRelease(
  gh: ReleaseGithub,
  ref: RepoRef,
  defaultBranch: string,
  asked: { version: string; bump: ReleaseBump },
): Promise<StartResult> {
  const state = await readRelease(gh, ref, defaultBranch, 0);
  const blocker = releaseBlocker(state);
  if (blocker) return { ok: false, status: 409, message: blocker };
  const s = state.suggestion!;
  if (s.version !== asked.version || s.bump !== asked.bump) {
    return { ok: false, status: 409, message: RELEASE_MESSAGES.stale };
  }
  const res = await gh.dispatchRelease(ref, defaultBranch, { bump: s.bump, version: s.version });
  if (!res.ok) {
    const message =
      res.status === 401 || res.status === 403 || res.status === 404
        ? RELEASE_MESSAGES.cannotPush
        : `GitHub would not start the release: ${res.message}`;
    return { ok: false, status: 502, message };
  }
  return { ok: true, message: RELEASE_MESSAGES.started, version: s.version };
}

/** What GET /api/packages/[slug]/release answers — the release panel's whole input. */
export type ReleasePanelData =
  | { access: { ok: false; reason: string; connectGithub: boolean } }
  | {
      access: { ok: true; via: "project" | "github" };
      release: ReleaseState;
      blocker: string | null;
    };
