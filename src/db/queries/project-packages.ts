import { and, asc, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import {
  projectPackageScans,
  projectPackages,
  userProjects,
  type PackageScanOutcome,
  type ProjectPackageScanRow,
} from "@/db/schema";
import type { ObservedPackage } from "@/lib/packages/manifest";
import type { PackageUse } from "@/lib/packages/view";

/** One observation, with the project it belongs to — what every Packages view reads. */
export type PackageUseRow = PackageUse;

const useColumns = {
  projectId: projectPackages.projectId,
  entityProjectId: userProjects.entityProjectId,
  projectName: userProjects.name,
  packageName: projectPackages.packageName,
  spec: projectPackages.spec,
  version: projectPackages.version,
  source: projectPackages.source,
  observedAt: projectPackages.observedAt,
};

/** Every package use across the user's active projects. */
export async function listPackageUses(userId: string): Promise<PackageUseRow[]> {
  return db
    .select(useColumns)
    .from(projectPackages)
    .innerJoin(userProjects, eq(userProjects.id, projectPackages.projectId))
    .where(and(eq(projectPackages.userId, userId), eq(userProjects.isActive, true)))
    .orderBy(asc(userProjects.name));
}

/** The user's active projects that use one package. */
export async function listPackageDependents(
  userId: string,
  packageName: string,
): Promise<PackageUseRow[]> {
  return db
    .select(useColumns)
    .from(projectPackages)
    .innerJoin(userProjects, eq(userProjects.id, projectPackages.projectId))
    .where(
      and(
        eq(projectPackages.userId, userId),
        eq(projectPackages.packageName, packageName),
        eq(userProjects.isActive, true),
      ),
    )
    .orderBy(asc(userProjects.name));
}

/** What one project is built from. Access to the project is the caller's check. */
export async function listProjectPackages(projectId: string): Promise<PackageUseRow[]> {
  return db
    .select(useColumns)
    .from(projectPackages)
    .innerJoin(userProjects, eq(userProjects.id, projectPackages.projectId))
    .where(eq(projectPackages.projectId, projectId))
    .orderBy(asc(projectPackages.packageName));
}

export async function listPackageScans(userId: string): Promise<ProjectPackageScanRow[]> {
  return db.select().from(projectPackageScans).where(eq(projectPackageScans.userId, userId));
}

export async function getPackageScanForProject(
  projectId: string,
): Promise<ProjectPackageScanRow | null> {
  const [row] = await db
    .select()
    .from(projectPackageScans)
    .where(eq(projectPackageScans.projectId, projectId))
    .limit(1);
  return row ?? null;
}

type ScanMeta = {
  userId: string;
  projectId: string;
  commitSha: string | null;
  catalogueKey: string;
  outcome: PackageScanOutcome;
  detail?: string | null;
  at?: Date;
};

async function upsertScan(tx: Pick<typeof db, "insert">, meta: ScanMeta, at: Date): Promise<void> {
  const values = {
    projectId: meta.projectId,
    userId: meta.userId,
    commitSha: meta.commitSha,
    catalogueKey: meta.catalogueKey,
    outcome: meta.outcome,
    detail: meta.detail ?? null,
    scannedAt: at,
  };
  await tx
    .insert(projectPackageScans)
    .values(values)
    .onConflictDoUpdate({ target: projectPackageScans.projectId, set: values });
}

/**
 * Replace what a project is built from with a fresh read: upsert every
 * observed package, delete the ones it no longer uses, record the scan. One
 * transaction, so a page never sees half of one read and half of another.
 */
export async function replaceProjectPackages(
  meta: Omit<ScanMeta, "outcome" | "detail">,
  observed: readonly ObservedPackage[],
): Promise<void> {
  const at = meta.at ?? new Date();
  await db.transaction(async (tx) => {
    for (const pkg of observed) {
      const values = {
        userId: meta.userId,
        projectId: meta.projectId,
        packageName: pkg.packageName,
        spec: pkg.spec,
        version: pkg.version,
        source: pkg.source,
        observedAt: at,
        commitSha: meta.commitSha,
        depName: pkg.depName,
      };
      await tx
        .insert(projectPackages)
        .values(values)
        .onConflictDoUpdate({
          target: [projectPackages.projectId, projectPackages.packageName],
          set: values,
        });
    }
    const names = observed.map((pkg) => pkg.packageName);
    await tx
      .delete(projectPackages)
      .where(
        names.length > 0
          ? and(
              eq(projectPackages.projectId, meta.projectId),
              notInArray(projectPackages.packageName, names),
            )
          : eq(projectPackages.projectId, meta.projectId),
      );
    await upsertScan(tx, { ...meta, outcome: "ok" }, at);
  });
}

/**
 * Record a read that did not produce an answer. The rows from the last good
 * read stay: "could not look" is not "uses nothing".
 */
export async function recordPackageScanFailure(meta: ScanMeta): Promise<void> {
  await upsertScan(db, meta, meta.at ?? new Date());
}

/** The repository has not moved since the last read: only the read time changes. */
export async function touchPackageScan(projectId: string, at: Date = new Date()): Promise<void> {
  await db
    .update(projectPackageScans)
    .set({ scannedAt: at })
    .where(eq(projectPackageScans.projectId, projectId));
}

/** A repository that has no package.json uses no package: clear its rows. */
export async function clearProjectPackages(meta: ScanMeta): Promise<void> {
  const at = meta.at ?? new Date();
  await db.transaction(async (tx) => {
    await tx.delete(projectPackages).where(eq(projectPackages.projectId, meta.projectId));
    await upsertScan(tx, meta, at);
  });
}
