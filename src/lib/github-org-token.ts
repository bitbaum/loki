/**
 * Which GitHub token writes to the fleet's organisation.
 *
 * Repositories are created in the org, never on a personal account. The
 * person's OAuth token cannot always do that: an org with OAuth-app access
 * restrictions refuses third-party apps until an owner approves them, and
 * that refusal (HTTP 403, "OAuth App access restrictions") is what stopped
 * every kickoff at "Creating the repository" on 2026-09-11.
 *
 * So org writes use a server-held token when one is configured
 * (`GITHUB_ORG_TOKEN`: an org admin's token with `repo` + `workflow` — the same
 * identity the box's site factory already creates repos with), and fall back
 * to the person's token otherwise. Identity-scoped reads (which repos does
 * this person have, who are they) keep using the person's token.
 *
 * WHO MAY USE IT. Two cases, and they are different questions:
 *
 * 1. CODE LOKI KEEPS. A person with an idea must not be sent to GitHub to
 *    open an account before an agent can write a line — that was the gate
 *    "Connect GitHub and the build carries on" put in front of every account
 *    but the founder's (2026-10-11). So creating a repository, seeding it and
 *    acting on one Loki created (custody "loki" on the project) uses the org
 *    token for EVERY signed-in account. Loki keeps the code; the person can
 *    take it to their own GitHub whenever they want (handover).
 * 2. EVERYTHING ELSE IN THE ORG. The token can archive and rewire any
 *    repository in the organisation, so on a repository Loki did NOT create
 *    it is offered only to accounts entitled to fleet-owned infrastructure
 *    (`isFleetInfrastructureAllowed` — founder or allowlist, the boundary the
 *    shared cloud builder draws). Everyone else gets their own token and, if
 *    their org refuses it, an honest 403. A server-held admin credential that
 *    any account could point at any org repository is a privilege escalation
 *    waiting for the first external user — and the custody column is what
 *    keeps case 1 from becoming that.
 */
export function getOrgGithubToken(): string | null {
  const token = process.env.GITHUB_ORG_TOKEN?.trim();
  return token ? token : null;
}

/** Pure: the token an org-scoped write should use. Exported for the test. */
export function pickRepoWriteToken(
  orgToken: string | null,
  userToken: string | null,
): { token: string; source: "org" | "user" } | null {
  if (orgToken) return { token: orgToken, source: "org" };
  if (userToken) return { token: userToken, source: "user" };
  return null;
}

export type RepoWriteScope = {
  /**
   * The write concerns code Loki keeps: creating a repository for a project
   * that has none, or acting on one whose custody is "loki". The caller
   * derives this from the project row (`lokiKeepsCode`), never from the
   * request.
   */
  lokiKept?: boolean;
};

/**
 * Pure: may the server's org token serve this write? Exported for the test.
 * Entitled accounts may always; anyone may for code Loki keeps.
 */
export function mayUseOrgToken(entitled: boolean, scope: RepoWriteScope = {}): boolean {
  return entitled || scope.lokiKept === true;
}

/**
 * Does Loki keep this project's code — i.e. may the org token act on its
 * repository for the person who owns the project? True when the project has
 * no repository yet (the one about to be created will be Loki's) or its
 * custody says so. A linked repository with no custody recorded is the
 * person's own.
 */
export function lokiKeepsCode(
  project: { gitUrl?: string | null; codeCustody?: string | null } | null | undefined,
): boolean {
  if (!project) return true;
  if (!project.gitUrl) return true;
  return project.codeCustody === "loki";
}

/**
 * The token for creating, seeding, wiring or deleting a repo in the org.
 * Null when neither a server token nor a linked GitHub account exists.
 */
export async function getRepoWriteToken(
  userId: string,
  scope: RepoWriteScope = {},
): Promise<{ token: string; source: "org" | "user" } | null> {
  const [{ getGithubToken }, { isFleetInfrastructureAllowed }] = await Promise.all([
    import("@/lib/github-token"),
    import("@/lib/execution-access"),
  ]);
  const [userToken, entitled] = await Promise.all([
    getGithubToken(userId),
    isFleetInfrastructureAllowed(userId),
  ]);
  return pickRepoWriteToken(
    mayUseOrgToken(entitled, scope) ? getOrgGithubToken() : null,
    userToken,
  );
}
