/**
 * Is a project on the latest version of a shared package, and if not, how far
 * behind is it?
 *
 * Pure: the Packages pages, the project's "Built from" panel and (later) the
 * update policies all read the answer from here, so they cannot disagree about
 * what "behind" means.
 *
 * Versions are compared as semver: `v` prefixes are ignored (git tags are
 * `v0.3.2`, npm versions are `0.3.2`), a pre-release ranks below its release,
 * and build metadata is ignored. Under 1.0 a minor bump is the breaking one —
 * that is how the fleet's own 0.x packages version — so `breaking` follows it.
 */

export type Semver = {
  major: number;
  minor: number;
  patch: number;
  /** Pre-release identifiers (`1.0.0-rc.1` → ["rc", "1"]); empty for a release. */
  pre: string[];
};

const SEMVER_RE =
  /^\s*v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/;

export function parseSemver(raw: string | null | undefined): Semver | null {
  if (!raw) return null;
  const m = SEMVER_RE.exec(raw);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split(".") : [],
  };
}

function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // a release outranks its pre-releases
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return Math.sign(d);
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** -1, 0 or 1. */
export function compareSemver(a: Semver, b: Semver): number {
  return (
    Math.sign(a.major - b.major) ||
    Math.sign(a.minor - b.minor) ||
    Math.sign(a.patch - b.patch) ||
    comparePre(a.pre, b.pre)
  );
}

/** The highest semver among tag names (`v0.2.0`, `0.3.1`, `nightly` …), or null. */
export function highestSemverTag(tags: readonly string[]): string | null {
  let best: { tag: string; v: Semver } | null = null;
  for (const tag of tags) {
    const v = parseSemver(tag);
    // A pre-release tag is not "the latest" a project should be asked to take.
    if (!v || v.pre.length > 0) continue;
    if (!best || compareSemver(v, best.v) > 0) best = { tag, v };
  }
  return best ? best.tag.replace(/^v/, "") : null;
}

export type BehindPart = "major" | "minor" | "patch" | "pre-release";

export type PackageStatus =
  | { kind: "latest" }
  | {
      kind: "behind";
      part: BehindPart;
      /** How many steps of that part (2 minors behind → 2). */
      steps: number;
      /** A bump the project's code may have to change for: a major, or a minor under 1.0. */
      breaking: boolean;
    }
  | {
      kind: "unknown";
      reason: "no-version" | "no-latest";
    };

/** Where `version` stands against `latest`. A version AHEAD of latest is on latest. */
export function packageStatus(
  version: string | null | undefined,
  latest: string | null | undefined,
): PackageStatus {
  const have = parseSemver(version);
  if (!have) return { kind: "unknown", reason: "no-version" };
  const want = parseSemver(latest);
  if (!want) return { kind: "unknown", reason: "no-latest" };
  if (compareSemver(have, want) >= 0) return { kind: "latest" };
  if (have.major !== want.major) {
    return { kind: "behind", part: "major", steps: want.major - have.major, breaking: true };
  }
  if (have.minor !== want.minor) {
    return {
      kind: "behind",
      part: "minor",
      steps: want.minor - have.minor,
      breaking: have.major === 0,
    };
  }
  if (have.patch !== want.patch) {
    return { kind: "behind", part: "patch", steps: want.patch - have.patch, breaking: false };
  }
  return { kind: "behind", part: "pre-release", steps: 1, breaking: false };
}

/** "2 minor versions behind", "1 major version behind", "on a pre-release". */
export function behindLabel(status: PackageStatus): string {
  if (status.kind === "latest") return "Latest";
  if (status.kind === "unknown") {
    return status.reason === "no-version" ? "Version unknown" : "Latest unknown";
  }
  if (status.part === "pre-release") return "On a pre-release";
  const noun = status.steps === 1 ? "version" : "versions";
  return `${status.steps} ${status.part} ${noun} behind`;
}

/** Sort weight: behind first (breaking before not), then unknown, then latest. */
export function statusRank(status: PackageStatus): number {
  if (status.kind === "behind") return status.breaking ? 0 : 1;
  if (status.kind === "unknown") return 2;
  return 3;
}
