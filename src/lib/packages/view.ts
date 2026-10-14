/**
 * The rows the Packages pages render, built from the catalogue, the latest
 * versions and the observed uses. Pure: the pages fetch, this decides.
 */
import type { CataloguePackage } from "./catalogue-parse";
import type { LatestVersion } from "./latest";
import type { PackageSource } from "./manifest";
import { packageStatus, parseSemver, statusRank, type PackageStatus } from "./status";
import type { PackageBump } from "./dependabot";
import {
  CI_STATE_LABELS,
  OPEN_UPDATE_STATES,
  needsDecision,
  updateStatus,
  whyAsked,
  type CiState,
  type UpdateRequestState,
  type UpdateStatus,
} from "./update-policy";
import { readPackageUpdateSetting, type UpdateDecision } from "@/config/package-updates";

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

export type DependentRow = PackageUse & {
  status: PackageStatus;
  href: string;
  /** The open update pull request for this package in this project, if any. */
  update?: OpenUpdate | null;
};

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

/** An open update pull request, as one package's row shows it. */
export type OpenUpdate = {
  prNumber: number;
  prUrl: string;
  from: string;
  to: string;
  breaking: boolean;
  status: UpdateStatus;
  /** Loki's last word on it (a refused write, a merge waiting on checks). */
  detail: string | null;
  /** Its version is paused by the package owner. */
  paused: boolean;
};

/** The fields of an update request these views read. */
export type UpdateRequestView = {
  projectId: string;
  prNumber: number;
  prUrl: string;
  packages: PackageBump[];
  state: UpdateRequestState;
  decision: UpdateDecision | null;
  ciState: CiState;
  detail: string | null;
  /** The project's stored setting, raw. */
  packageUpdates: string;
  /** A version it moves to is paused by its package's owner (matched by the loader). */
  paused?: boolean;
};

/** `projectId|packageName` → the open update that bumps it (the newest pull request wins). */
export function indexOpenUpdates(requests: readonly UpdateRequestView[]): Map<string, OpenUpdate> {
  const out = new Map<string, OpenUpdate>();
  const ordered = [...requests].sort((a, b) => b.prNumber - a.prNumber);
  for (const r of ordered) {
    if (!OPEN_UPDATE_STATES.includes(r.state)) continue;
    const status = updateStatus(r, readPackageUpdateSetting(r.packageUpdates), r.paused === true);
    for (const bump of r.packages) {
      if (!bump.fleet) continue;
      const key = `${r.projectId}|${bump.name}`;
      if (out.has(key)) continue;
      out.set(key, {
        prNumber: r.prNumber,
        prUrl: r.prUrl,
        from: bump.from,
        to: bump.to,
        breaking: bump.breaking,
        status,
        detail: r.detail,
        paused: r.paused === true,
      });
    }
  }
  return out;
}

/** `0.3.2` / `v0.3.2` → `v0.3.2`; anything not semver (a sha) as it is. */
export function versionLabel(version: string): string {
  return parseSemver(version) ? `v${version.trim().replace(/^v/, "")}` : version;
}

/** One held update on Approvals. */
export type UpdateCard = {
  id: string;
  projectName: string;
  projectHref: string;
  prNumber: number;
  prUrl: string;
  /** The fleet packages it updates, versions labelled. */
  bumps: Array<{ name: string; from: string; to: string; breaking: boolean }>;
  /** Updates in the same pull request to packages outside the fleet. */
  otherCount: number;
  checks: UpdateStatus;
  why: string;
  detail: string | null;
  /** Its version is paused by the package owner: an answer given now applies when it is resumed. */
  paused: boolean;
};

const CI_TONE: Record<CiState, UpdateStatus["tone"]> = {
  green: "positive",
  pending: "neutral",
  red: "negative",
  unknown: "neutral",
};

/** The updates waiting for a decision, as cards, breaking first, then by project. */
export function buildUpdateCards(
  rows: ReadonlyArray<
    UpdateRequestView & {
      id: string;
      projectName: string;
      entityProjectId: string | null;
      snoozedUntil: Date | null;
    }
  >,
  nowMs: number,
): UpdateCard[] {
  return rows
    .filter((r) => needsDecision(r, readPackageUpdateSetting(r.packageUpdates), nowMs))
    .map((r) => {
      const fleet = r.packages.filter((p) => p.fleet);
      return {
        id: r.id,
        projectName: r.projectName,
        projectHref: projectHref(r),
        prNumber: r.prNumber,
        prUrl: r.prUrl,
        bumps: fleet.map((p) => ({
          name: p.name,
          from: versionLabel(p.from),
          to: versionLabel(p.to),
          breaking: p.breaking,
        })),
        otherCount: r.packages.length - fleet.length,
        checks: { label: CI_STATE_LABELS[r.ciState], tone: CI_TONE[r.ciState] },
        why: whyAsked(r.packages),
        detail: r.detail,
        paused: r.paused === true,
      };
    })
    .sort(
      (a, b) =>
        Number(b.bumps.some((x) => x.breaking)) - Number(a.bumps.some((x) => x.breaking)) ||
        a.projectName.localeCompare(b.projectName) ||
        a.prNumber - b.prNumber,
    );
}
