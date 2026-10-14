/**
 * Kit coverage: of the packages a kickoff planned, how many the first build
 * actually installed. The kickoff run records `planned` when it dispatches and
 * `observed` once the repository is read after the build has had time to land
 * (orchestration_runs.payload.kitPlan); this turns the pair into a number, so
 * whether the plan works can be measured across sites instead of guessed.
 *
 * Pure: no network, no database.
 */
import { FIRST_BUILD_SETTLE_MS } from "@/config/kit-plan";
import type { KitRunRecord } from "./types";

export type { KitRunRecord };

export type KitCoverage = {
  planned: string[];
  /** Planned and installed. */
  covered: string[];
  /** Planned, not installed. */
  missing: string[];
  /** Installed although not planned (fleet packages the agent found on its own). */
  unplanned: string[];
  /** covered / planned, or null when nothing was planned. */
  ratio: number | null;
};

export function kitCoverage(planned: readonly string[], observed: readonly string[]): KitCoverage {
  const seen = new Set(observed);
  const wanted = new Set(planned);
  const covered = planned.filter((name) => seen.has(name));
  return {
    planned: [...planned],
    covered,
    missing: planned.filter((name) => !seen.has(name)),
    unplanned: observed.filter((name) => !wanted.has(name)),
    ratio: planned.length > 0 ? covered.length / planned.length : null,
  };
}

/**
 * Should this read be frozen into the kickoff run as "what the first build
 * installed"? Only once: the run has closed, the read came at least
 * FIRST_BUILD_SETTLE_MS after it (the build's pull request has merged by then),
 * and the read succeeded.
 */
export function shouldRecordObserved(args: {
  record: KitRunRecord | null | undefined;
  runFinishedAt: Date | null;
  scan: { scannedAt: Date; outcome: string } | null;
}): boolean {
  const { record, runFinishedAt, scan } = args;
  if (!record || record.observed || !runFinishedAt || !scan) return false;
  if (scan.outcome !== "ok" && scan.outcome !== "no-manifest") return false;
  return scan.scannedAt.getTime() - runFinishedAt.getTime() >= FIRST_BUILD_SETTLE_MS;
}
