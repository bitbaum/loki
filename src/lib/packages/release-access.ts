/**
 * Who may release a package from Loki, and pause one of its releases
 * everywhere: its OWNER.
 *
 *   1. If a Loki project's repository IS the package repository, the
 *      accounts that own such a project are its owners, and nobody else is —
 *      even someone whose GitHub access could push there. The project is how
 *      Loki already knows whose the code is.
 *   2. If no project is the package repository (a package nobody registered
 *      as a project), any account whose GitHub access can push to it.
 *
 * Either way GitHub has the last word: the token Loki would act with must be
 * able to push, or nothing is offered. Loki never shows a button GitHub would
 * refuse, and never lends an account the server's org token for a repository
 * it may not use it on (repoTokenPicker → github-org-token.ts).
 */
import { RELEASE_MESSAGES } from "@/config/package-releases";
import { listProjectsForRepo } from "@/db/queries/package-releases";
import { parseGithubRepo, type RepoRef } from "@/lib/github-repo-ref";
import type { CataloguePackage } from "./catalogue-parse";
import { decideReleaseAccess } from "./release";
import { githubReleaseClient, type ReleaseGithub } from "./release-github";
import { repoTokenPicker } from "./sync";

export type ReleaseAccess =
  | {
      ok: true;
      via: "project" | "github";
      ref: RepoRef;
      defaultBranch: string;
      gh: ReleaseGithub;
      /** The token `gh` acts with — for the few writes ReleaseGithub has no method for. */
      token: string;
    }
  | { ok: false; reason: string; connectGithub: boolean };

/** Look the owner up for one package and one viewer. Never throws. */
export async function resolveReleaseAccess(
  userId: string,
  pkg: Pick<CataloguePackage, "repo">,
): Promise<ReleaseAccess> {
  const ref = parseGithubRepo(pkg.repo ? `https://github.com/${pkg.repo}` : null);
  if (!ref) return { ok: false, reason: RELEASE_MESSAGES.noRepo, connectGithub: false };
  try {
    const [projects, tokenFor] = await Promise.all([
      listProjectsForRepo(ref.slug),
      repoTokenPicker(userId),
    ]);
    const owners = [...new Set(projects.map((p) => p.userId))];
    const own = projects.find((p) => p.userId === userId);
    // Without a project of theirs the repository is not code Loki keeps for
    // them, so the org token is offered only to an entitled account.
    const token = tokenFor(
      own ?? { gitUrl: `https://github.com/${ref.slug}`, codeCustody: null },
      ref,
    );
    const facts = { hasRepo: true, projectOwnerIds: owners, viewerId: userId };
    // Settle what needs no GitHub call first: not the owner, or no token.
    const early = decideReleaseAccess({ ...facts, hasToken: token !== null, canPush: true });
    if (!early.ok) return early;
    const gh = githubReleaseClient(token);
    const repo = await gh.repoAccess(ref);
    const decision = decideReleaseAccess({
      ...facts,
      hasToken: true,
      canPush: repo?.canPush ?? null,
    });
    if (!decision.ok) return decision;
    if (!repo) return { ok: false, reason: RELEASE_MESSAGES.unreadable, connectGithub: false };
    return { ...decision, ref, defaultBranch: repo.defaultBranch, gh, token: token as string };
  } catch {
    return { ok: false, reason: RELEASE_MESSAGES.unreadable, connectGithub: false };
  }
}
