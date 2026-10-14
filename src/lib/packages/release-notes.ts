/**
 * What has changed since a package's last release, and which version that
 * makes the next one. Pure: the commits come from GitHub (./release-github.ts),
 * the answer goes to the package page.
 *
 * The commit messages are conventional commits — the fleet writes them that
 * way everywhere (`feat(x): …`, `fix: …`, `refactor!: …`):
 *   - a `!` after the type, or a `BREAKING CHANGE:` line in the body → breaking
 *   - `feat` → a new feature
 *   - anything else (fix, perf, chore, docs, a message with no type) → a fix
 *
 * Breaking follows Loki's dependabot.ts and the fleet sweep exactly: a new
 * major, or a new minor UNDER 1.0. So under 1.0 a breaking change raises the
 * minor, and a feature raises only the patch — a feature that raised the minor
 * would read as breaking to every consumer and wait for a person in every
 * project, which is the opposite of what a feature release is for.
 */
import type { ReleaseBump } from "@/config/package-releases";
import { isBreakingBump } from "./dependabot";
import { parseSemver } from "./status";

export type CommitKind = "breaking" | "feature" | "fix";

export type ReleaseCommit = {
  sha: string;
  /** The whole message; the first line is its title. */
  message: string;
  url: string | null;
};

const HEADER = /^([a-z]+)(?:\([^)]*\))?(!)?:\s*\S/i;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;

/** The first line of a commit message. */
export function commitTitle(message: string): string {
  return message.split("\n", 1)[0]!.trim();
}

/** What one commit means for the next version. */
export function commitKind(message: string): CommitKind {
  const m = HEADER.exec(commitTitle(message));
  if ((m && m[2] === "!") || BREAKING_FOOTER.test(message)) return "breaking";
  if (m && m[1]!.toLowerCase() === "feat") return "feature";
  return "fix";
}

export type ReleaseSuggestion = {
  bump: ReleaseBump;
  /** Without a `v`. */
  version: string;
  kind: CommitKind;
  /** Every project will be asked before taking it (dependabot.ts's rule). */
  breaking: boolean;
};

/** The version one bump makes from `current` (a pre-release is released at its own number). */
export function nextVersion(current: string, bump: ReleaseBump): string | null {
  const v = parseSemver(current);
  if (!v) return null;
  if (v.pre.length > 0) return `${v.major}.${v.minor}.${v.patch}`;
  if (bump === "major") return `${v.major + 1}.0.0`;
  if (bump === "minor") return `${v.major}.${v.minor + 1}.0`;
  return `${v.major}.${v.minor}.${v.patch + 1}`;
}

/**
 * The next release for these unreleased commits, or null when there is
 * nothing to release or no released version to count from.
 */
export function suggestRelease(
  current: string | null,
  commits: readonly Pick<ReleaseCommit, "message">[],
): ReleaseSuggestion | null {
  if (!current || commits.length === 0 || !parseSemver(current)) return null;
  const kinds = commits.map((c) => commitKind(c.message));
  const kind: CommitKind = kinds.includes("breaking")
    ? "breaking"
    : kinds.includes("feature")
      ? "feature"
      : "fix";
  const underOne = parseSemver(current)!.major === 0;
  const bump: ReleaseBump =
    kind === "breaking"
      ? underOne
        ? "minor"
        : "major"
      : kind === "feature" && !underOne
        ? "minor"
        : "patch";
  const version = nextVersion(current, bump)!;
  return { bump, version, kind, breaking: isBreakingBump(current, version) };
}
