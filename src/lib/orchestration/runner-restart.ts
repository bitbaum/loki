/**
 * Which open runs a runner RESTART ended — decided from facts, not a timer.
 *
 * A runner's agent sessions are PTYs it owns. When the runner process restarts
 * (OOM stop, deploy drain), every one of those sessions dies with it, but the
 * runs they were serving stayed open until the time reaper noticed an hour
 * later. Meanwhile Control said "Previous automated run: waiting" and the rail
 * said the agent was working. Observed 2026-09-25: a Skif run started 10:39:51
 * was killed at 10:53 with loki-box-runner, and read `waiting` until 11:40.
 *
 * The runner now reports when its process booted. A run is ended by that boot
 * only when ALL of these hold — each one is a fact, none is a guess:
 *   - it was on the rebooted runner's channel (a run pinned elsewhere, or
 *     with no recorded channel, proves nothing about THIS runner);
 *   - its agent session was demonstrably live before the boot: a session
 *     event (claimed / launched / submitted / generating / progress) older
 *     than bootedAt;
 *   - nothing has been heard from it since the boot (a session event at or
 *     after bootedAt means a live runner has it — clock skew between a laptop
 *     and the database must never close a run the new process just started);
 *   - no command for it is still outstanding. A claimed-but-unacked command
 *     is reclaimed and re-run by the new runner, so its run is not over.
 *
 * A run that was only `dispatched` (queued, never reached a session) is left
 * alone: the new runner will claim it.
 */

/** Run-ledger kinds that prove an agent session was serving the run. */
export const SESSION_EVENT_KINDS = [
  "claimed",
  "launched",
  "submitted",
  "generating",
  "progress",
] as const;

/** A bootedAt older than this is not a boot we will act on — a runner that has
 *  been up a week has no fresh restart to report, and a garbage value that
 *  happens to parse must not sweep the ledger. */
export const MAX_BOOT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Tolerance for a runner clock slightly ahead of the server's. Beyond it the
 *  value is "in the future" and ignored. */
export const BOOT_CLOCK_SKEW_MS = 2 * 60 * 1000;

/** A usable boot time, or null. Never throws; anything doubtful is null. */
export function parseBootedAt(raw: unknown, nowMs: number): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  if (raw > nowMs + BOOT_CLOCK_SKEW_MS) return null;
  if (raw < nowMs - MAX_BOOT_AGE_MS) return null;
  return raw;
}

export interface OpenRunRestartFacts {
  id: string;
  /** Channel the run's command was pinned to; null when none was recorded. */
  channel: string | null;
  /** Earliest session event (SESSION_EVENT_KINDS), epoch ms, or null. */
  firstSessionEventAtMs: number | null;
  /** Latest session event, epoch ms, or null. */
  lastSessionEventAtMs: number | null;
  /** A command for this run is claimed-or-queued but not yet acked. */
  hasOutstandingCommand: boolean;
}

/** Ids of the runs this boot ended. Pure. */
export function runsEndedByRestart(
  runs: readonly OpenRunRestartFacts[],
  boot: { bootedAtMs: number; channel: string },
): string[] {
  return runs
    .filter(
      (r) =>
        r.channel === boot.channel &&
        r.firstSessionEventAtMs != null &&
        r.firstSessionEventAtMs < boot.bootedAtMs &&
        (r.lastSessionEventAtMs == null || r.lastSessionEventAtMs < boot.bootedAtMs) &&
        !r.hasOutstandingCommand,
    )
    .map((r) => r.id);
}

/** The sentence recorded on a run this boot ended. */
export function runnerRestartReason(bootedAtMs: number): string {
  const hhmm = new Date(bootedAtMs).toISOString().slice(11, 16);
  return `The builder restarted at ${hhmm} UTC and this run's agent session ended with it.`;
}
