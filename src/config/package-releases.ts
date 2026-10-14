/**
 * Releasing a shared package from Loki, and pausing a bad release everywhere —
 * the one place the words, the limits and the request bodies are defined.
 *
 * The release itself is the package repository's own `release.yml`, rendered
 * from bitbaum/fleet `templates/package` (bitbaum/fleet SHARED.md → "Releasing").
 * Loki starts it with an exact version and reads back what happened; it never
 * builds, tags or pushes anything itself.
 *
 * WHO MAY RELEASE (and pause): the package's owner, decided in
 * src/lib/packages/release-access.ts —
 *   1. if any Loki project's repository IS the package repository, the
 *      account(s) that own such a project, and nobody else;
 *   2. if no project is the package repository, any account whose GitHub
 *      access GitHub itself says can push to it.
 * Either way GitHub must agree the token Loki would use can push: Loki never
 * starts a release GitHub would refuse.
 */
import { z } from "zod";

/** The workflow file in every package repository (bitbaum/fleet templates/package). */
export const RELEASE_WORKFLOW_FILE = "release.yml";

/** Where the workflow comes from, for a repository that does not have it yet. */
export const RELEASE_TEMPLATE_URL =
  "https://github.com/bitbaum/fleet/blob/main/templates/package/.github/workflows/release.yml";

/** The fleet job that offers missing template files to every declared package repository. */
export const TEMPLATE_SYNC_URL =
  "https://github.com/bitbaum/fleet/actions/workflows/package-repos.yml";

/** The branch that job opens its pull request from (bitbaum/fleet scripts/packages/sync-package-template.mjs). */
export const TEMPLATE_SYNC_BRANCH = "fleet/template-sync";

/** At most this many unreleased changes are listed (the count is always exact up to GitHub's 250). */
export const UNRELEASED_LIST_LIMIT = 8;

/** How many versions the rollout shows, newest first. */
export const ROLLOUT_VERSIONS = 5;

/** Release starts per person per hour — each one is a full build in the package repository. */
export const RELEASES_PER_HOUR = 6;

/** Pause / resume presses per person per minute — each one reads every affected project's pull requests. */
export const PAUSES_PER_MINUTE = 6;

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The part of the version a release raises. */
export type ReleaseBump = "major" | "minor" | "patch";

/** The body of POST /api/packages/[slug]/release: exactly the version the button showed. */
export const StartReleaseBody = z.object({
  version: z.string().trim().regex(VERSION, "A version looks like 0.3.0"),
  bump: z.enum(["major", "minor", "patch"]),
});

/** The body of POST /api/packages/[slug]/pause. */
export const ReleasePauseBody = z.object({
  version: z
    .string()
    .trim()
    .transform((v) => v.replace(/^v/, ""))
    .pipe(z.string().regex(VERSION, "A version looks like 0.3.0")),
  paused: z.boolean(),
});

/** The plain-words name of each kind of release, for the button's explanation. */
export const BUMP_WORDS: Record<ReleaseBump, string> = {
  major: "a breaking release",
  minor: "a release with new features",
  patch: "a release with fixes",
};

/** Said on the release panel and in the routes' refusals. */
export const RELEASE_MESSAGES = {
  noRepo:
    "The register names no GitHub repository for this package, so it cannot be released from here.",
  notOwner:
    "Only the package's owner can release it — the owner of the Loki project that is this package's repository.",
  connectGithub:
    "Loki has no GitHub access that can write to this package's repository. Connect GitHub with an account that can.",
  cannotPush: "GitHub says your access cannot write to this package's repository.",
  unreadable:
    "GitHub did not answer about this package's repository just now. Try again in a minute.",
  noWorkflow:
    "This repository cannot release from here yet: it has no release.yml, the fleet's release step.",
  nothingToRelease: "Nothing has changed since the last release.",
  noTag:
    "This repository has no release tag yet (like v0.1.0), so there is no version to count from. Tag the current version on GitHub first.",
  running: "A release is already running. Wait for it to finish.",
  mainUnknown:
    "No checks have reported on the latest change yet, so a release would be refused. Wait for them, or look at the repository's checks.",
  mainRed:
    "The latest change on main failed its checks, so a release would be refused. Fix main first.",
  mainRunning: "Checks are still running on the latest change. A release can start when they pass.",
  stale: "Something changed since this page was read. Look at the new suggestion and press again.",
  started:
    "Release started. The new version appears here once it is tagged — usually within a few minutes.",
  rateLimited: "Several releases were started in the last hour — wait a while before the next one.",
} as const;

/** Said on a paused release, wherever its updates appear. */
export const PAUSED_BY_OWNER = "Paused by the package owner";

export const PAUSE_MESSAGES = {
  explain:
    "Pausing holds every open update to this version, in every project, whatever its setting. Resuming takes off only the holds the pause added.",
  appliesLater:
    "Projects whose updates could not be reached now are held on the next read, within 15 minutes.",
} as const;

/** What a pause or a resume did, in one sentence. */
export function pauseResultMessage(
  paused: boolean,
  version: string,
  applied: { projects: number; held: number; failed: number },
): string {
  const v = `v${version}`;
  const later = applied.failed > 0 ? ` ${PAUSE_MESSAGES.appliesLater}` : "";
  if (!paused) {
    return `Resumed ${v}. The holds the pause added are off; each update follows its project's setting again.${later}`;
  }
  if (applied.projects === 0) {
    return `Paused ${v}. No project has an update to it open yet; any that opens is held.`;
  }
  const of = `${applied.held} of ${applied.projects} ${applied.projects === 1 ? "project" : "projects"}`;
  return `Paused ${v}. Held in ${of} with an update to it open.${later}`;
}
