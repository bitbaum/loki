/**
 * What the Packages pages and the project's "Built from" panel load — one
 * gatherer per surface, so the pages stay thin and every surface reads the
 * catalogue, the latest versions and the observations the same way.
 */
import { getUserProjects } from "@/db/queries/user-projects";
import {
  getPackageScanForProject,
  listPackageDependents,
  listPackageScans,
  listPackageUses,
  listProjectPackages,
} from "@/db/queries/project-packages";
import type { ProjectPackageScanRow } from "@/db/schema";
import {
  getProjectPackageUpdates,
  listOpenUpdateRequests,
  listRecentDecidedUpdateRequests,
  listProjectUpdateRequests,
} from "@/db/queries/package-updates";
import {
  DEFAULT_PACKAGE_UPDATE_SETTING,
  readPackageUpdateSetting,
  type PackageUpdateSetting,
} from "@/config/package-updates";
import { listReleasePauses } from "@/db/queries/package-releases";
import { parseGithubRepo } from "@/lib/github-repo-ref";
import { findCataloguePackage, getPackageCatalogue, type PackageCatalogue } from "./catalogue";
import type { CataloguePackage } from "./catalogue-parse";
import { getLatestVersions, type LatestVersion } from "./latest";
import { resolveReleaseAccess } from "./release-access";
import { pauseFor, type ReleasePause } from "./release-pause";
import { buildRollout, type RolloutRow } from "./rollout";
import { packagesAreStale } from "./rules";
import {
  buildBuiltFrom,
  buildDependents,
  buildPackageList,
  buildDecidedUpdates,
  buildUpdateCards,
  indexOpenUpdates,
  projectHref,
  type DependentRow,
  type OpenUpdate,
  type PackageListRow,
  type DecidedUpdate,
  type UpdateCard,
} from "./view";

/** How far the reads of the person's repositories got. */
export type ReadCoverage = {
  /** Active projects with a GitHub repository. */
  withRepo: number;
  /** …of which have been read successfully at least once. */
  read: number;
  /** The latest reads that failed, with the reason, for a project link. */
  failures: Array<{ projectId: string; projectName: string; href: string; detail: string }>;
  lastReadAt: Date | null;
  stale: boolean;
};

async function readCoverage(userId: string, nowMs: number): Promise<ReadCoverage> {
  const [projects, scans] = await Promise.all([getUserProjects(userId), listPackageScans(userId)]);
  const withRepo = projects.filter((p) => parseGithubRepo(p.gitUrl));
  const byProject = new Map<string, ProjectPackageScanRow>(scans.map((s) => [s.projectId, s]));
  const relevant = withRepo.flatMap((p) => {
    const scan = byProject.get(p.id);
    return scan ? [{ project: p, scan }] : [];
  });
  const failures = relevant
    .filter(({ scan }) => scan.outcome === "unreachable" || scan.outcome === "error")
    .map(({ project, scan }) => ({
      projectId: project.id,
      projectName: project.name,
      href: projectHref({ entityProjectId: project.entityProjectId, projectName: project.name }),
      detail: scan.detail ?? "Could not be read.",
    }));
  const times = relevant.map(({ scan }) => scan.scannedAt.getTime());
  return {
    withRepo: withRepo.length,
    read: relevant.filter(({ scan }) => scan.outcome === "ok" || scan.outcome === "no-manifest")
      .length,
    failures,
    lastReadAt: times.length ? new Date(Math.max(...times)) : null,
    stale: packagesAreStale(
      relevant.map(({ scan }) => scan),
      withRepo.length,
      nowMs,
    ),
  };
}

/** Every paused release; none when the table cannot be read (a pause is then shown as absent, not invented). */
async function readPauses(): Promise<ReleasePause[]> {
  return listReleasePauses().catch(() => []);
}

/** Mark each update whose version its package's owner paused. */
function markPaused<T extends { packages: Parameters<typeof pauseFor>[0] }>(
  rows: readonly T[],
  pauses: readonly ReleasePause[],
): Array<T & { paused: boolean }> {
  return rows.map((r) => ({ ...r, paused: pauseFor(r.packages, pauses) !== null }));
}

export type PackagesOverview = {
  catalogue: PackageCatalogue;
  rows: PackageListRow[];
  coverage: ReadCoverage;
};

export async function loadPackagesOverview(
  userId: string,
  nowMs = Date.now(),
): Promise<PackagesOverview> {
  const [catalogue, uses, coverage] = await Promise.all([
    getPackageCatalogue(),
    listPackageUses(userId),
    readCoverage(userId, nowMs),
  ]);
  const latest = await getLatestVersions(catalogue.packages);
  return { catalogue, rows: buildPackageList(catalogue.packages, latest, uses), coverage };
}

export type PackageDetail = {
  catalogue: PackageCatalogue;
  pkg: CataloguePackage | null;
  latest: LatestVersion;
  dependents: DependentRow[];
  coverage: ReadCoverage;
  /** Recent versions and how far each has reached the person's projects. */
  rollout: RolloutRow[];
  /** The viewer is the package's owner (may release it, and pause its releases). */
  owner: boolean;
};

export async function loadPackageDetail(
  userId: string,
  slug: string,
  nowMs = Date.now(),
): Promise<PackageDetail> {
  const [catalogue, coverage] = await Promise.all([
    getPackageCatalogue(),
    readCoverage(userId, nowMs),
  ]);
  const pkg = findCataloguePackage(catalogue.packages, slug);
  if (!pkg) {
    return {
      catalogue,
      pkg,
      latest: { version: null, from: "none" },
      dependents: [],
      coverage,
      rollout: [],
      owner: false,
    };
  }
  const [latestMap, uses, rawUpdates, pauses, access] = await Promise.all([
    getLatestVersions([pkg]),
    listPackageDependents(userId, pkg.name),
    listOpenUpdateRequests(userId).catch(() => []),
    readPauses(),
    resolveReleaseAccess(userId, pkg),
  ]);
  const latest = latestMap.get(pkg.name) ?? { version: null, from: "none" as const };
  const updates = markPaused(rawUpdates, pauses);
  const open = indexOpenUpdates(updates);
  const dependents = buildDependents(uses, latest).map((row) => ({
    ...row,
    update: open.get(`${row.projectId}|${pkg.name}`) ?? null,
  }));
  const rollout = buildRollout({
    packageName: pkg.name,
    latest: latest.version,
    dependents,
    requests: updates,
    pauses,
  });
  return { catalogue, pkg, latest, dependents, coverage, rollout, owner: access.ok };
}

export type BuiltFrom = {
  rows: Array<ReturnType<typeof buildBuiltFrom>[number] & { update: OpenUpdate | null }>;
  scan: ProjectPackageScanRow | null;
  /** How updates reach this project. */
  setting: PackageUpdateSetting;
};

/** What one project is built from. The caller has already checked access to it. */
export async function loadProjectBuiltFrom(projectId: string): Promise<BuiltFrom> {
  const [catalogue, uses, scan, requests, rawSetting, pauses] = await Promise.all([
    getPackageCatalogue(),
    listProjectPackages(projectId),
    getPackageScanForProject(projectId),
    listProjectUpdateRequests(projectId).catch(() => []),
    getProjectPackageUpdates(projectId).catch(() => null),
    readPauses(),
  ]);
  const used = catalogue.packages.filter((pkg) => uses.some((u) => u.packageName === pkg.name));
  const latest = await getLatestVersions(used);
  const packageUpdates = rawSetting ?? DEFAULT_PACKAGE_UPDATE_SETTING;
  const open = indexOpenUpdates(
    markPaused(requests, pauses).map((r) => ({ ...r, packageUpdates })),
  );
  const rows = buildBuiltFrom(uses, catalogue.packages, latest).map((row) => ({
    ...row,
    update: open.get(`${projectId}|${row.packageName}`) ?? null,
  }));
  return { rows, scan, setting: readPackageUpdateSetting(packageUpdates) };
}

/** The package updates waiting for the person on Approvals. Never throws. */
export async function loadUpdateCards(userId: string, nowMs = Date.now()): Promise<UpdateCard[]> {
  const [rows, pauses] = await Promise.all([
    listOpenUpdateRequests(userId).catch(() => []),
    readPauses(),
  ]);
  return buildUpdateCards(markPaused(rows, pauses), nowMs);
}

const DECIDED_WINDOW_DAYS = 14;
const DECIDED_LIMIT = 8;

/** What the person answered on Approvals in the last two weeks. Never throws. */
export async function loadRecentUpdateDecisions(
  userId: string,
  nowMs = Date.now(),
): Promise<DecidedUpdate[]> {
  const since = new Date(nowMs - DECIDED_WINDOW_DAYS * 86_400_000);
  const rows = await listRecentDecidedUpdateRequests(userId, since, DECIDED_LIMIT).catch(() => []);
  return buildDecidedUpdates(rows);
}
