/**
 * The two decisions the package sync makes that are worth a test of their
 * own, kept free of I/O so the test needs no database or network.
 */

/** Data older than this is read again when a Packages surface is opened. */
export const PACKAGES_STALE_MS = 6 * 60 * 60 * 1000;

/**
 * The token to read a repository with, or null to read it anonymously (a
 * public repository needs none). The fleet org's server token is offered only
 * for a repository IN the org and only when the person may use it there
 * (github-org-token.ts → mayUseOrgToken); everywhere else it is the person's
 * own GitHub token.
 */
export function pickReadToken(input: {
  repoOwner: string;
  orgOwner: string;
  orgToken: string | null;
  orgAllowed: boolean;
  userToken: string | null;
}): string | null {
  const inOrg = input.repoOwner.toLowerCase() === input.orgOwner.toLowerCase();
  if (inOrg && input.orgAllowed && input.orgToken) return input.orgToken;
  return input.userToken;
}

/**
 * Should a Packages surface read the repositories again on sight? Yes when a
 * repository has never been read, or the oldest read is over six hours old.
 */
export function packagesAreStale(
  scans: readonly { scannedAt: Date }[],
  projectsWithRepo: number,
  nowMs: number,
): boolean {
  if (projectsWithRepo === 0) return false;
  if (scans.length < projectsWithRepo) return true;
  const oldest = Math.min(...scans.map((s) => s.scannedAt.getTime()));
  return nowMs - oldest > PACKAGES_STALE_MS;
}
