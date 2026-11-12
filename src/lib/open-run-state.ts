/**
 * What an unfinished run is actually doing — one rule for every surface.
 *
 * Activity called every run without a finish time "Running" (25 of them on
 * 2026-11-12, some silent or never picked up for hours) while Home, reading
 * the same run, said "Waiting for you". Home's rule is the honest one; it
 * lives here so Activity reads it too.
 *
 *   waiting      the agent stopped for a person: a sign-in, an approval, or
 *                it quit and needs sending again
 *   silent       it reported a step once, then nothing for longer than
 *                RUN_PROGRESS_FRESH_MS
 *   not_started  sent more than NOT_PICKED_UP_MS ago and never reported a step
 *   running      everything else: picked up, or still on its way
 */
import { isRunProgressFresh } from "@/lib/run-progress";

/** A run sent this long ago that never reported a step has not been picked
 *  up: it is waiting on a builder, not being built. */
export const NOT_PICKED_UP_MS = 30 * 60_000;

export type OpenRunState = "waiting" | "silent" | "not_started" | "running";

export type OpenRunSignals = {
  /** When the run was sent (ms). */
  startedAt: number | null;
  lastProgressAt?: string | null;
  lastStep?: { text?: string | null } | null;
  blocked?: string | null;
};

export function openRunState(run: OpenRunSignals, nowMs: number): OpenRunState {
  if (run.blocked) return "waiting";
  if (run.lastProgressAt && !isRunProgressFresh(run.lastProgressAt, nowMs)) return "silent";
  if (!run.lastStep?.text && run.startedAt !== null && nowMs - run.startedAt > NOT_PICKED_UP_MS)
    return "not_started";
  return "running";
}

/** The same signals, read from a run's stored payload (orchestration_runs). */
export function openRunSignalsFromPayload(
  startedAt: Date | number | null,
  payload: Record<string, unknown> | null | undefined,
): OpenRunSignals {
  const step = payload?.lastStep as { text?: unknown } | null | undefined;
  return {
    startedAt:
      startedAt === null ? null : typeof startedAt === "number" ? startedAt : startedAt.getTime(),
    lastProgressAt: typeof payload?.lastProgressAt === "string" ? payload.lastProgressAt : null,
    lastStep: step && typeof step.text === "string" ? { text: step.text } : null,
    blocked: typeof payload?.blocked === "string" ? payload.blocked : null,
  };
}
