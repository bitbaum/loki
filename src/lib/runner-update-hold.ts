/**
 * Letting a builder update land: while the cloud builder runs code older
 * than this deploy, Loki hands it no NEW work, so the idle moment its
 * restart waits for actually comes.
 *
 * The box runner restarts only when no agent is working (drain-and-restart-
 * runner.sh): a restart kills every session it owns, and a half-done task is
 * not recoverable. But autopilot refilled the queue the moment an agent
 * finished, so "no agent working" never arrived: from 2026-10-17 23:38 to
 * 2026-10-18 09:12 ten consecutive deploys each found the drain still
 * deferring ("2 agent(s) working"), and the always-on builder ran code days
 * behind the app — the conversation view said "Model: not known yet" of an
 * answer it was showing, because the frames came from a runner that predates
 * the field.
 *
 * The rule lives on the SERVER, in the commands route the runner polls, so
 * it holds for a runner that predates it (a runner-side rule would have had
 * to wait for the very restart it was meant to make possible). The runner's
 * version comes from its own heartbeat (runtime_snapshots) and the deploy's
 * from config/changelog; while the first is behind the second, the commands
 * that would START work stay queued (they run, in order, after the restart)
 * and the ones a person is waiting on this second — typing into a live
 * session, closing a tab, looking at a screen — go through. The running
 * agents finish, nothing new starts, the drain restarts the runner, the
 * queue drains on the new code. Control's builder line says so meanwhile
 * (lib/builder-presence builderUpdateNote), and so does the answer to the
 * person who sent the task (EXECUTOR_COPY.inject.builderUpdating). The wait
 * is bounded: UPDATE_HOLD_MAX_MS below.
 *
 * Pure: the route reads the versions, this decides.
 */
import {
  FLEET_RUNNER_COMMAND_TYPES,
  type FleetRunnerCommandType,
} from "./pending-command-contract";

/**
 * Commands that start work an update would then have to wait for. `inject`
 * is not one: it is a person's own words into a session they are looking
 * at, and a held message would read as a dead Send. A message to an idle
 * session does wake it, which the drain then waits for — the cost of never
 * holding a person's words.
 */
export const HELD_WHILE_UPDATING: readonly FleetRunnerCommandType[] = [
  "dispatch",
  "launch_agent",
  "auto_continue",
  "browser_task",
];

export function holdsNewWork(type: string): boolean {
  return (HELD_WHILE_UPDATING as readonly string[]).includes(type);
}

/**
 * The longest one task waits for the restart. The hold had no end, and the
 * restart it waits for does not always come: the drain counts every sealed
 * session and every agent that is not Claude as working for as long as its
 * session is open, gives up after six hours and is not tried again. On
 * 2026-11-12 two runner releases landed 35 minutes apart, the drain read
 * "5 agent(s) working" on every look from 05:08 to 06:07 UTC, and in that
 * hour the builder claimed screen peeks and nothing else: every task a
 * person sent sat queued while the chat said it would start shortly.
 *
 * So the hold buys the drain a quiet stretch and no more. A task that has
 * waited this long is handed to the builder on the code it has; running on
 * last week's runner is recoverable, a task that never starts is not. Five
 * minutes is three looks of the drain on a loaded box (it logged one every
 * 95 seconds that morning).
 */
export const UPDATE_HOLD_MINUTES = 5;
export const UPDATE_HOLD_MAX_MS = UPDATE_HOLD_MINUTES * 60_000;

/**
 * How long after a runner release the hold applies at all. A builder that
 * is still behind two hours after the release is not about to restart: its
 * sessions have not gone idle in all that time, and holding each new task
 * for the full bound would then be a tax on every task with nothing bought
 * by it. Past the window work starts at once on the code the builder has,
 * and the next release opens the window again.
 */
export const UPDATE_HOLD_WINDOW_MS = 2 * 60 * 60_000;

/**
 * Is the hold's window open for a release published at `releasedAt`? A date
 * that cannot be read keeps it open: each task is still bounded on its own.
 */
export function holdWindowOpen(releasedAt: string | null | undefined, now: number): boolean {
  const at = releasedAt ? Date.parse(releasedAt) : Number.NaN;
  if (!Number.isFinite(at)) return true;
  return now - at < UPDATE_HOLD_WINDOW_MS;
}

/**
 * What a person is told while their task waits on the update, instead of
 * "starting shortly": why it has not started, when it will at the latest,
 * and that nothing is asked of them. One wording for the chat, the API
 * answer and the run's track.
 */
export const BUILDER_UPDATING_SENTENCE = `The cloud runner is taking an update. This starts when its running agents finish, or in ${UPDATE_HOLD_MINUTES} minutes at the latest. Nothing to do.`;

/** The same fact as a short label under a sent task. */
export const BUILDER_UPDATING_LABEL = `With the cloud runner — starts within ${UPDATE_HOLD_MINUTES} minutes (it is updating)`;

/** The work-starters among what a runner asked for (all of them when it
 *  named none): the types handed over only once a row has waited out the hold. */
export function heldTypes(requested: readonly string[] | undefined): string[] {
  const asked = requested?.length ? requested : FLEET_RUNNER_COMMAND_TYPES;
  return asked.filter(holdsNewWork);
}

/**
 * The command types to claim for a runner: the ones it asked for (all of
 * them when it named none), minus the work-starters while its update waits.
 */
export function claimableTypes(
  requested: readonly string[] | undefined,
  holding: boolean,
): string[] {
  const asked = requested?.length ? requested : FLEET_RUNNER_COMMAND_TYPES;
  return holding ? asked.filter((t) => !holdsNewWork(t)) : [...asked];
}
