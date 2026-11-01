/**
 * Is the machine actually running the Fleet Runner we published?
 *
 * WHY THIS EXISTS
 * ---------------
 * Loki publishes desktop releases and had no idea whether any machine
 * ever installed one. Both halves of that sentence were load-bearing on
 * 2026-08-26:
 *
 *   * releases had not been cut at all for 12 days (nobody minted the tag —
 *     fixed in #370/#374), and
 *   * the laptop was still running 0.8.12 while the box ran box-0.8.13.
 *
 * The consequence was not cosmetic. 0.8.12 predates the inject-hardening that
 * landed 2026-08-23 (`c350623c`), so that runner acked an unverified inject as
 * `ok: true` and left the run to be reaped an hour later instead of failing
 * fast. 29 runs died that way and were billed to the projects whose prompts
 * went unanswered. A machine quietly running old code produced degraded
 * behaviour for twelve days and nothing anywhere said so.
 *
 * The comparison needs no network and no new data: `FLEET_RUNNER_RELEASES` is
 * already the SSOT for what has shipped, and every runner already reports its
 * version on every heartbeat. Nothing was missing except the subtraction.
 */
import { FLEET_RUNNER_RELEASES } from "@/config/changelog";
import { isCloudRunnerVersion } from "@/lib/builder-presence";

export type RunnerVersionState = "current" | "behind" | "ahead" | "unknown";

export type RunnerVersionReading = {
  state: RunnerVersionState;
  /** As reported by the runner, verbatim (may carry a `box-` prefix). */
  reported: string | null;
  /** Bare semver with any channel prefix stripped, or null when unparsable. */
  normalized: string | null;
  latest: string;
  /** How many published releases are newer than the reported one. */
  behindBy: number;
  detail: string;
};

/** `box-0.8.13` → `0.8.13`. The box runner prefixes its channel; the desktop
 *  app does not. Comparing without stripping made every box runner look
 *  unparsable, which would have reported the fleet's most current runner as
 *  the least knowable one. */
export function normalizeRunnerVersion(version: string | null | undefined): string | null {
  if (!version) return null;
  const bare = isCloudRunnerVersion(version) ? version.replace(/^box[-/]/, "") : version;
  return /^\d+\.\d+\.\d+/.test(bare) ? bare : null;
}

function compare(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function runnerVersionStatus(
  reported: string | null | undefined,
  releases: readonly { version: string }[] = FLEET_RUNNER_RELEASES,
): RunnerVersionReading {
  const latest = releases[0]?.version ?? "0.0.0";
  const normalized = normalizeRunnerVersion(reported);

  // A runner that has never reported is not a runner that is up to date. This
  // is the whole point: silence must not be read as health.
  if (!normalized) {
    return {
      state: "unknown",
      reported: reported ?? null,
      normalized: null,
      latest,
      behindBy: 0,
      detail: reported
        ? `Runner reports "${reported}", which is not a version this can compare — treat as UNKNOWN, not current.`
        : "No runner has reported a version — whether any machine is up to date is unknown.",
    };
  }

  const diff = compare(normalized, latest);
  if (diff > 0) {
    return {
      state: "ahead",
      reported: reported ?? null,
      normalized,
      latest,
      behindBy: 0,
      // Not an error: the box runs deploy-synced code, so it legitimately
      // reaches a version before that version is tagged and published.
      detail: `Runner ${normalized} is ahead of the newest published release (${latest}) — expected for a deploy-synced runner.`,
    };
  }
  if (diff === 0) {
    return {
      state: "current",
      reported: reported ?? null,
      normalized,
      latest,
      behindBy: 0,
      detail: `Runner is on ${normalized}, the newest published release.`,
    };
  }

  const behindBy = releases.filter((r) => compare(r.version, normalized) > 0).length;
  return {
    state: "behind",
    reported: reported ?? null,
    normalized,
    latest,
    behindBy,
    detail:
      `Runner is on ${normalized}; ${latest} is published (${behindBy} release${behindBy === 1 ? "" : "s"} behind). ` +
      `Desktop features merged since then are dormant on that machine — this is exactly how 0.8.12 kept acking ` +
      `unverified injects for twelve days.`,
  };
}
