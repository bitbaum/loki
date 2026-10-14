/**
 * How a package's recent releases are rolling out across the person's
 * projects — derived, never stored: from what each project was last read to
 * be on (project_packages) and the update pull requests open in it
 * (package_update_requests), plus the pauses.
 *
 * For each version, every project that uses the package lands in exactly one
 * bucket: already on it, an update to it open (and where that update stands),
 * behind it with no update to it yet, or past it. Pure.
 */
import { ROLLOUT_VERSIONS } from "@/config/package-releases";
import { RELEASED_ON_GITHUB } from "@/config/package-updates";
import { normalizeVersion, type ReleasePause } from "./release-pause";
import { compareSemver, parseSemver } from "./status";
import type { PackageUse, UpdateRequestView } from "./view";
import { OPEN_UPDATE_STATES } from "./update-policy";

export type RolloutBucket =
  "on" | "red" | "paused" | "held" | "ready" | "waiting" | "behind" | "newer" | "unknown";

/** The buckets in the order a row shows them, each with its words. */
export const ROLLOUT_BUCKETS: ReadonlyArray<{ id: RolloutBucket; label: string }> = [
  { id: "on", label: "on it" },
  { id: "ready", label: "update ready" },
  { id: "waiting", label: "update waiting on tests" },
  { id: "held", label: "update held" },
  { id: "paused", label: "update paused" },
  { id: "red", label: "tests failed" },
  { id: "behind", label: "behind, no update yet" },
  { id: "newer", label: "on a newer version" },
  { id: "unknown", label: "version unknown" },
];

export type RedProject = { projectName: string; href: string; prUrl: string; prNumber: number };

export type RolloutRow = {
  /** Without a `v`. */
  version: string;
  latest: boolean;
  pause: ReleasePause | null;
  counts: Record<RolloutBucket, number>;
  /** Projects whose update to this version failed its checks. */
  red: RedProject[];
};

type Dependent = Pick<PackageUse, "projectId" | "projectName" | "version"> & { href: string };
type Request = Pick<
  UpdateRequestView,
  "projectId" | "prNumber" | "prUrl" | "packages" | "state" | "decision" | "ciState"
>;

const empty = (): Record<RolloutBucket, number> => ({
  on: 0,
  red: 0,
  paused: 0,
  held: 0,
  ready: 0,
  waiting: 0,
  behind: 0,
  newer: 0,
  unknown: 0,
});

/**
 * The versions worth a row, newest first: the latest, what projects are on,
 * what open updates move to — at most ROLLOUT_VERSIONS, plus any paused
 * version older than that (a pause must never drop off the page).
 */
export function rolloutVersions(
  latest: string | null,
  seen: readonly (string | null)[],
  paused: readonly string[],
): string[] {
  const all = new Map<string, NonNullable<ReturnType<typeof parseSemver>>>();
  for (const raw of [latest, ...seen, ...paused]) {
    if (!raw) continue;
    const v = normalizeVersion(raw);
    const parsed = parseSemver(v);
    if (parsed && parsed.pre.length === 0) all.set(v, parsed);
  }
  const sorted = [...all.entries()].sort((a, b) => compareSemver(b[1], a[1])).map(([v]) => v);
  const top = sorted.slice(0, ROLLOUT_VERSIONS);
  return [...top, ...sorted.slice(ROLLOUT_VERSIONS).filter((v) => paused.includes(v))];
}

/** Where one open update to a version stands. */
function updateBucket(r: Request, paused: boolean): RolloutBucket {
  if (r.ciState === "red") return "red";
  if (paused && r.decision !== RELEASED_ON_GITHUB) return "paused";
  if (r.state === "held") return "held";
  if (r.ciState === "green") return "ready";
  return "waiting";
}

/** One row per version (see rolloutVersions), for one package. */
export function buildRollout(input: {
  packageName: string;
  latest: string | null;
  dependents: readonly Dependent[];
  requests: readonly Request[];
  pauses: readonly ReleasePause[];
}): RolloutRow[] {
  const pauses = input.pauses.filter((p) => p.packageName === input.packageName);
  // projectId → the version each open update moves this package to (newest pull request first).
  const open = new Map<string, Array<{ to: string; r: Request }>>();
  for (const r of [...input.requests].sort((a, b) => b.prNumber - a.prNumber)) {
    if (!OPEN_UPDATE_STATES.includes(r.state)) continue;
    for (const b of r.packages) {
      if (!b.fleet || b.name !== input.packageName) continue;
      const list = open.get(r.projectId) ?? [];
      list.push({ to: normalizeVersion(b.to), r });
      open.set(r.projectId, list);
    }
  }
  const versions = rolloutVersions(
    input.latest,
    [...input.dependents.map((d) => d.version), ...[...open.values()].flat().map((u) => u.to)],
    pauses.map((p) => p.version),
  );
  return versions.map((version) => {
    const pause = pauses.find((p) => p.version === version) ?? null;
    const target = parseSemver(version)!;
    const counts = empty();
    const red: RedProject[] = [];
    for (const d of input.dependents) {
      const mine = d.version ? normalizeVersion(d.version) : null;
      const update = open.get(d.projectId)?.find((u) => u.to === version);
      let bucket: RolloutBucket;
      if (mine === version) bucket = "on";
      else if (update) bucket = updateBucket(update.r, pause !== null);
      else {
        const v = parseSemver(mine);
        bucket = !v ? "unknown" : compareSemver(v, target) < 0 ? "behind" : "newer";
      }
      counts[bucket]++;
      if (bucket === "red" && update) {
        red.push({
          projectName: d.projectName,
          href: d.href,
          prUrl: update.r.prUrl,
          prNumber: update.r.prNumber,
        });
      }
    }
    return {
      version,
      latest: input.latest !== null && normalizeVersion(input.latest) === version,
      pause,
      counts,
      red,
    };
  });
}

/** "Red in 2 projects — their tests fail on v0.3.0", or null when none are. */
export function redFlag(row: Pick<RolloutRow, "version" | "red">): string | null {
  const n = row.red.length;
  if (n === 0) return null;
  return `Red in ${n} ${n === 1 ? "project" : "projects"} — ${n === 1 ? "its" : "their"} tests fail on v${row.version}`;
}
