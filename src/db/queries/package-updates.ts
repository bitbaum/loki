import { and, asc, desc, eq, gte, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  packageUpdateRequests,
  projectPackages,
  userProjects,
  type NewPackageUpdateRequestRow,
  type PackageUpdateRequestRow,
  type UserProject,
} from "@/db/schema";
import type { PackageUpdateSetting } from "@/config/package-updates";
import { OPEN_UPDATE_STATES } from "@/lib/packages/update-policy";
import type { UpdateStore } from "@/lib/packages/updates";

/** An update request with the project it belongs to — what the pages render. */
export type UpdateRequestWithProject = PackageUpdateRequestRow & {
  projectName: string;
  entityProjectId: string | null;
  /** The project's stored setting, raw — read it through readPackageUpdateSetting. */
  packageUpdates: string;
};

const withProject = {
  request: packageUpdateRequests,
  projectName: userProjects.name,
  entityProjectId: userProjects.entityProjectId,
  packageUpdates: userProjects.packageUpdates,
};

/** Every request Loki has on record for one project (open first, newest first). */
export async function listProjectUpdateRequests(
  projectId: string,
): Promise<PackageUpdateRequestRow[]> {
  return db
    .select()
    .from(packageUpdateRequests)
    .where(eq(packageUpdateRequests.projectId, projectId))
    .orderBy(desc(packageUpdateRequests.openedAt));
}

/** The user's update requests whose pull request is still open, across active projects. */
export async function listOpenUpdateRequests(userId: string): Promise<UpdateRequestWithProject[]> {
  const rows = await db
    .select(withProject)
    .from(packageUpdateRequests)
    .innerJoin(userProjects, eq(userProjects.id, packageUpdateRequests.projectId))
    .where(
      and(
        eq(packageUpdateRequests.userId, userId),
        eq(userProjects.isActive, true),
        inArray(packageUpdateRequests.state, [...OPEN_UPDATE_STATES]),
      ),
    )
    .orderBy(asc(userProjects.name), asc(packageUpdateRequests.prNumber));
  return rows.map(({ request, ...project }) => ({ ...request, ...project }));
}

/** What the person decided on Approvals lately, newest first — the record that outlives the card. */
export async function listRecentDecidedUpdateRequests(
  userId: string,
  since: Date,
  limit: number,
): Promise<UpdateRequestWithProject[]> {
  const rows = await db
    .select(withProject)
    .from(packageUpdateRequests)
    .innerJoin(userProjects, eq(userProjects.id, packageUpdateRequests.projectId))
    .where(
      and(
        eq(packageUpdateRequests.userId, userId),
        isNotNull(packageUpdateRequests.decision),
        gte(packageUpdateRequests.decidedAt, since),
      ),
    )
    .orderBy(desc(packageUpdateRequests.decidedAt))
    .limit(limit);
  return rows.map(({ request, ...project }) => ({ ...request, ...project }));
}

/** One request, only if it is the user's. */
export async function getUpdateRequestForUser(
  userId: string,
  id: string,
): Promise<{ request: PackageUpdateRequestRow; project: UserProject } | null> {
  const [row] = await db
    .select({ request: packageUpdateRequests, project: userProjects })
    .from(packageUpdateRequests)
    .innerJoin(userProjects, eq(userProjects.id, packageUpdateRequests.projectId))
    .where(and(eq(packageUpdateRequests.id, id), eq(packageUpdateRequests.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Write what was just read (and decided) about one pull request. */
export async function upsertUpdateRequest(
  values: NewPackageUpdateRequestRow,
): Promise<PackageUpdateRequestRow> {
  const { id: _id, ...set } = values;
  const [row] = await db
    .insert(packageUpdateRequests)
    .values(values)
    .onConflictDoUpdate({
      target: [packageUpdateRequests.projectId, packageUpdateRequests.prNumber],
      set,
    })
    .returning();
  return row!;
}

/** Record the person's decision (and its note) without re-reading GitHub. */
export async function updateUpdateRequest(
  id: string,
  patch: Partial<
    Pick<PackageUpdateRequestRow, "decision" | "decidedAt" | "snoozedUntil" | "detail" | "state">
  >,
): Promise<void> {
  await db.update(packageUpdateRequests).set(patch).where(eq(packageUpdateRequests.id, id));
}

/** The keys a project's package.json lists its fleet packages under. */
export async function listProjectPackageKeys(
  projectId: string,
): Promise<Array<{ packageName: string; depName: string | null }>> {
  return db
    .select({ packageName: projectPackages.packageName, depName: projectPackages.depName })
    .from(projectPackages)
    .where(eq(projectPackages.projectId, projectId));
}

/**
 * Set how package updates reach one project, addressed by EITHER of its ids
 * (the project page holds the entity id, the "Built from" panel the row id).
 * Owner only: the row must be the caller's.
 */
export async function setProjectPackageUpdates(
  userId: string,
  projectId: string,
  setting: PackageUpdateSetting,
): Promise<UserProject | null> {
  const [row] = await db
    .update(userProjects)
    .set({ packageUpdates: setting, updatedAt: new Date() })
    .where(
      and(
        eq(userProjects.userId, userId),
        or(eq(userProjects.id, projectId), eq(userProjects.entityProjectId, projectId)),
      ),
    )
    .returning();
  return row ?? null;
}

/** The database half of src/lib/packages/updates.ts. */
export const dbUpdateStore: UpdateStore = {
  listForProject: listProjectUpdateRequests,
  listPackageKeys: listProjectPackageKeys,
  async upsert(values) {
    await upsertUpdateRequest(values);
  },
  patch: updateUpdateRequest,
};

/** One project's stored update setting, raw (null when the project is gone). */
export async function getProjectPackageUpdates(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ packageUpdates: userProjects.packageUpdates })
    .from(userProjects)
    .where(eq(userProjects.id, projectId))
    .limit(1);
  return row?.packageUpdates ?? null;
}
