/**
 * A run that has gone silent does not hold its project against a waiting
 * message.
 *
 * A project's shared session takes one message at a time: the claim gate
 * (olderOpenRunSql) withholds the next one until the run ahead has CLOSED. A
 * run closes when its agent reports (a handoff, a pull request) or when the
 * reaper gives up on it, and the reaper shelters a run for as long as the
 * project has an agent process, up to MAX_RUN_HOURS. An agent that ended its
 * turn without reporting (it answered a question, it hit a usage wall, its
 * turn simply stopped) still has a process, sitting at its prompt. So the
 * next message to that project waited up to twelve hours behind a session
 * that was doing nothing.
 *
 * Measured on the live site, 2026-11-12: four messages sent through Loki's
 * own chat to `loki` and `orangecat` each read "This project is still on an
 * earlier task" and were still queued 25 to 35 minutes later.
 *
 * The runner already says whether a run's agent is working: it beats while
 * the terminal prints, and it keeps beating while the agent waits at a
 * sign-in or an approval it can name (lib/run-progress). No beat for
 * RUN_PROGRESS_FRESH_MS already reads "Stalled" on every surface. This rule
 * acts on the same signal, twice as late, and only when a message is waiting:
 * the silent run is closed and the message is typed into the idle session,
 * which is what a person would do by hand.
 *
 * It is NOT a timer on the run's age. The lane floor that once released a run
 * an hour after it started typed the next prompt into an agent that was
 * still working (db/queries/orchestration-runs.ts, laneLifeFloorSql). A working
 * agent prints, so its last beat is seconds old however long it has run.
 *
 * Pure: the caller gathers the facts and applies the answer.
 */
import { RUN_BLOCKED, RUN_PROGRESS_FRESH_MS } from "@/lib/run-progress";

/** Silence, measured from the run's last beat (or from delivery when it never
 *  printed), after which a waiting message may take the session. Twice the
 *  window after which the product itself calls the run stalled. */
export const QUIET_LANE_MS = 2 * RUN_PROGRESS_FRESH_MS;
export const QUIET_LANE_MINUTES = QUIET_LANE_MS / 60_000;

/**
 * How long a run must STAY silent after it was first seen silent with a
 * message waiting. A runner that lost its connection for a while could not
 * beat, and its first request after coming back may be the claim, before the
 * beat. One beat interval and a retry fit inside this.
 */
export const QUIET_LANE_CONFIRM_MS = 90_000;

export type QuietLaneFacts = {
  /** When the run's prompt reached an agent; null when it never did. */
  deliveredAtMs: number | null;
  /** The runner's last beat for this run; null when it never beat. */
  lastProgressAtMs: number | null;
  /** payload.blocked: why the agent is quiet, when the runner could tell. */
  blocked: string | null;
  /** A command for this run is queued or claimed and not yet answered. */
  hasOutstandingCommand: boolean;
  /** When this rule first saw the run silent with a message waiting. */
  quietSeenAtMs: number | null;
};

export type QuietLaneStep =
  /** The run keeps the lane. */
  | { kind: "hold" }
  /** Silent with a message waiting, seen for the first time: note when. */
  | { kind: "mark" }
  /** Still silent after the confirmation window: close it. */
  | { kind: "release"; quietSinceMs: number };

/** The last moment the run's agent is known to have been doing anything. */
export function lastSignOfLifeMs(
  f: Pick<QuietLaneFacts, "deliveredAtMs" | "lastProgressAtMs">,
): number | null {
  if (f.deliveredAtMs == null) return null;
  return Math.max(f.deliveredAtMs, f.lastProgressAtMs ?? 0);
}

/**
 * What to do with the run at the head of a lane that a message waits behind.
 *
 * Holds whenever the silence could be something else:
 *   - the prompt never reached an agent (the run is itself still starting);
 *   - a command for it is outstanding (the runner is delivering to it);
 *   - the agent waits for a person at a sign-in or an approval. Text typed
 *     there answers the question instead of starting the next task; the run
 *     reads "Needs you" with the question until someone answers it.
 */
export function quietLaneStep(f: QuietLaneFacts, nowMs: number): QuietLaneStep {
  const alive = lastSignOfLifeMs(f);
  if (alive == null) return { kind: "hold" };
  if (f.hasOutstandingCommand) return { kind: "hold" };
  if (f.blocked === RUN_BLOCKED.AUTH || f.blocked === RUN_BLOCKED.PERMISSION) {
    return { kind: "hold" };
  }
  if (nowMs - alive < QUIET_LANE_MS) return { kind: "hold" };
  // A mark older than the run's last sign of life belongs to an earlier
  // silence the agent has since broken; start the confirmation again.
  if (f.quietSeenAtMs == null || f.quietSeenAtMs < alive) return { kind: "mark" };
  if (nowMs - f.quietSeenAtMs < QUIET_LANE_CONFIRM_MS) return { kind: "hold" };
  return { kind: "release", quietSinceMs: alive };
}

/** The sentence recorded on a run this rule closed. */
export function quietLaneReason(quietSinceMs: number, nowMs: number): string {
  const minutes = Math.max(QUIET_LANE_MINUTES, Math.round((nowMs - quietSinceMs) / 60_000));
  return `The agent printed nothing for ${minutes} minutes and did not report back, so this run was ended and the next message for the project started.`;
}
