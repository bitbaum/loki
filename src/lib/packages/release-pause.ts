/**
 * Which open updates a paused release reaches. Pure — the pauses come from
 * `package_release_pauses` and the bumps from `package_update_requests`; this
 * only matches them, so every surface (enforcement, Approvals, the package
 * page) agrees on what "paused" covers.
 *
 * A pause names a package and the version it must not reach: an update that
 * moves that package TO that version, in any project. An update to a later
 * version is not paused — releasing a fix is how a bad version is left behind.
 */
import type { PackageBump } from "./dependabot";

export type ReleasePause = {
  packageName: string;
  /** Without a `v`: `0.3.0`. */
  version: string;
  pausedAt: Date;
};

/** `v0.3.0`, `` `0.3.0` ``, ` 0.3.0 ` → `0.3.0`. Not semver (a sha) stays as it is. */
export function normalizeVersion(raw: string): string {
  return raw
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/^v(?=\d)/, "");
}

/** The pause an update falls under, if any (the earliest, when it moves two paused packages). */
export function pauseFor(
  bumps: readonly Pick<PackageBump, "name" | "to" | "fleet">[],
  pauses: readonly ReleasePause[],
): ReleasePause | null {
  let found: ReleasePause | null = null;
  for (const bump of bumps) {
    if (!bump.fleet) continue;
    const to = normalizeVersion(bump.to);
    for (const p of pauses) {
      if (p.packageName !== bump.name || p.version !== to) continue;
      if (!found || p.pausedAt.getTime() < found.pausedAt.getTime()) found = p;
    }
  }
  return found;
}

/** Does an update move `packageName` to `version`? */
export function bumpsTo(
  bumps: readonly Pick<PackageBump, "name" | "to" | "fleet">[],
  packageName: string,
  version: string,
): boolean {
  return bumps.some((b) => b.fleet && b.name === packageName && normalizeVersion(b.to) === version);
}
