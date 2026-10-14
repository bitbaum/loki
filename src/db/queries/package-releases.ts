import { and, asc, eq, ilike, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  packageReleasePauses,
  packageUpdateRequests,
  userProjects,
  type PackageUpdateRequestRow,
  type UserProject,
} from "@/db/schema";
import { parseGithubRepo } from "@/lib/github-repo-ref";
import { OPEN_UPDATE_STATES } from "@/lib/packages/update-policy";
import { bumpsTo, type ReleasePause } from "@/lib/packages/release-pause";

/** Every paused release (they are few: one row per paused version). */
export async function listReleasePauses(): Promise<ReleasePause[]> {
  return db
    .select({
      packageName: packageReleasePauses.packageName,
      version: packageReleasePauses.version,
      pausedAt: packageReleasePauses.pausedAt,
    })
    .from(packageReleasePauses)
    .orderBy(asc(packageReleasePauses.pausedAt));
}

/** Pause a release. Pausing a paused one keeps its original time. */
export async function pauseRelease(
  userId: string,
  packageName: string,
  version: string,
): Promise<void> {
  await db
    .insert(packageReleasePauses)
    .values({ userId, packageName, version })
    .onConflictDoNothing({
      target: [packageReleasePauses.packageName, packageReleasePauses.version],
    });
}

/** Lift a pause. */
export async function resumeRelease(packageName: string, version: string): Promise<void> {
  await db
    .delete(packageReleasePauses)
    .where(
      and(
        eq(packageReleasePauses.packageName, packageName),
        eq(packageReleasePauses.version, version),
      ),
    );
}

/**
 * Who owns an active Loki project whose repository is `slug` (`owner/repo`),
 * across every account — the first half of "who is this package's owner"
 * (src/lib/packages/release-access.ts). Matched on the parsed repository, not
 * the URL text, so an ssh remote and an https link with `.git` are the same
 * repository; the LIKE only narrows the candidates.
 */
export async function listProjectsForRepo(slug: string): Promise<UserProject[]> {
  const [, repo] = slug.split("/");
  if (!repo) return [];
  const candidates = await db
    .select()
    .from(userProjects)
    .where(
      and(
        eq(userProjects.isActive, true),
        isNotNull(userProjects.gitUrl),
        ilike(userProjects.gitUrl, `%${repo.replace(/[\\%_]/g, (c) => `\\${c}`)}%`),
      ),
    );
  const want = slug.toLowerCase();
  return candidates.filter((p) => parseGithubRepo(p.gitUrl)?.slug.toLowerCase() === want);
}

/**
 * Every open update, in any account, that moves `packageName` to `version`,
 * with its project — what a pause or a resume has to reach at once.
 */
export async function listOpenRequestsTo(
  packageName: string,
  version: string,
): Promise<Array<{ request: PackageUpdateRequestRow; project: UserProject }>> {
  const rows = await db
    .select({ request: packageUpdateRequests, project: userProjects })
    .from(packageUpdateRequests)
    .innerJoin(userProjects, eq(userProjects.id, packageUpdateRequests.projectId))
    .where(
      and(
        eq(userProjects.isActive, true),
        inArray(packageUpdateRequests.state, [...OPEN_UPDATE_STATES]),
        // Narrow in the database to rows that update this package at all;
        // the version is matched below, where `v` and backticks are handled.
        sql`${packageUpdateRequests.packages} @> ${JSON.stringify([{ name: packageName, fleet: true }])}::jsonb`,
      ),
    );
  return rows.filter((r) => bumpsTo(r.request.packages, packageName, version));
}
