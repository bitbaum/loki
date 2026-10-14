/**
 * The rows the Packages pages render, built from the catalogue, the latest
 * versions and the observed uses. Pure: the pages fetch, this decides.
 */
import type { CataloguePackage } from "./catalogue-parse";
import type { LatestVersion } from "./latest";
import type { PackageSource } from "./manifest";
import { packageStatus, statusRank, type PackageStatus } from "./status";

/** The minimum an observation needs to carry for these views. */
export type PackageUse = {
  projectId: string;
  entityProjectId: string | null;
  projectName: string;
  packageName: string;
  spec: string;
  version: string | null;
  source: PackageSource;
  observedAt: Date;
};

export type PackageListRow = {
  slug: string;
  name: string;
  summary: string | null;
  latest: LatestVersion;
  usedBy: number;
  onLatest: number;
  behind: number;
  unknown: number;
};

export type DependentRow = PackageUse & { status: PackageStatus; href: string };

/** Where a project's page lives — by its entity id, or found by name. */
export function projectHref(use: Pick<PackageUse, "entityProjectId" | "projectName">): string {
  return use.entityProjectId
    ? `/projects/${use.entityProjectId}`
    : `/projects?project=${encodeURIComponent(use.projectName)}`;
}

const NONE: LatestVersion = { version: null, from: "none" };

/**
 * One row per catalogue package, in the catalogue's order, plus a row for
 * nothing else: a project dependency the catalogue does not list is not a
 * fleet package as far as this page knows.
 */
export function buildPackageList(
  catalogue: readonly CataloguePackage[],
  latest: ReadonlyMap<string, LatestVersion>,
  uses: readonly PackageUse[],
): PackageListRow[] {
  return catalogue.map((pkg) => {
    const l = latest.get(pkg.name) ?? NONE;
    const mine = uses.filter((u) => u.packageName === pkg.name);
    let onLatest = 0;
    let behind = 0;
    let unknown = 0;
    for (const use of mine) {
      const s = packageStatus(use.version, l.version);
      if (s.kind === "latest") onLatest++;
      else if (s.kind === "behind") behind++;
      else unknown++;
    }
    return {
      slug: pkg.slug,
      name: pkg.name,
      summary: pkg.summary,
      latest: l,
      usedBy: mine.length,
      onLatest,
      behind,
      unknown,
    };
  });
}

/** A package's dependents, behind first (breaking before not), then unknown, then latest. */
export function buildDependents(
  uses: readonly PackageUse[],
  latest: LatestVersion,
): DependentRow[] {
  return uses
    .map((use) => ({
      ...use,
      status: packageStatus(use.version, latest.version),
      href: projectHref(use),
    }))
    .sort(
      (a, b) =>
        statusRank(a.status) - statusRank(b.status) || a.projectName.localeCompare(b.projectName),
    );
}

/** A project's own packages, with the slug to link each one to (null when unlisted). */
export function buildBuiltFrom(
  uses: readonly PackageUse[],
  catalogue: readonly CataloguePackage[],
  latest: ReadonlyMap<string, LatestVersion>,
): Array<PackageUse & { slug: string | null; status: PackageStatus; latest: LatestVersion }> {
  return uses
    .map((use) => {
      const pkg = catalogue.find((p) => p.name === use.packageName) ?? null;
      const l = latest.get(use.packageName) ?? NONE;
      return {
        ...use,
        slug: pkg?.slug ?? null,
        latest: l,
        status: packageStatus(use.version, l.version),
      };
    })
    .sort(
      (a, b) =>
        statusRank(a.status) - statusRank(b.status) || a.packageName.localeCompare(b.packageName),
    );
}
