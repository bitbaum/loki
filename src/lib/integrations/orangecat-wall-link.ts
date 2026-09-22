/**
 * Where an OrangeCat wall entry sends the reader — and whether Loki may post
 * one at all.
 *
 * Pure by construction (no db, no network), like orangecat-run-moment beside
 * it, so the DB-free unit suite can exercise the two rules that matter most on
 * this seam and the only two a reader on the other product ever feels.
 */

import { LOKI_PUBLIC_ORIGIN } from "@/config/orangecat-publish";
import { canonicalSlug, repoFromGitUrl } from "@/lib/register/build";
import { publicProfilePath } from "@/lib/register/map";

/** What the two rules below need to know about a project. */
export type WallLinkProject = {
  slug: string | null;
  gitUrl: string | null;
  name: string;
  listedPublicly: boolean;
  /** null = the question has never been answered. */
  orangecatAutopost: boolean | null;
};

/**
 * May Loki post this project's activity to its OrangeCat wall?
 *
 * Explicit `true` only. `null` is not a quiet yes: publishing a project used
 * to enrol it in a live feed of everything its agents did, with no way to stop
 * that short of taking the public page down, and this is the switch that
 * separates the two decisions. A project that has never been asked stays
 * silent until someone answers.
 */
export function mayPostActivity(project: Pick<WallLinkProject, "orangecatAutopost"> | undefined) {
  return project?.orangecatAutopost === true;
}

/**
 * The back-link on a wall entry.
 *
 * Every entry Loki has ever published carried `/projects` — the operator's
 * private dashboard. A stranger following it from OrangeCat got a sign-in
 * form; the owner got all 36 of their projects instead of the one the entry
 * was about. The right page existed the whole time and is the one /fleet links
 * to, derived here exactly as the register derives it so the URL resolves.
 *
 * Without public-listing consent there IS no such page (and there must not
 * be), so the catalogue is the fallback: still public, still about Loki, and
 * never a login wall.
 */
export function wallLinkFor(project: WallLinkProject | undefined): string {
  if (!project?.listedPublicly) return `${LOKI_PUBLIC_ORIGIN}/fleet`;
  const slug = canonicalSlug(project.slug || repoFromGitUrl(project.gitUrl) || project.name);
  return slug ? `${LOKI_PUBLIC_ORIGIN}${publicProfilePath(slug)}` : `${LOKI_PUBLIC_ORIGIN}/fleet`;
}
