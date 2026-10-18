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
 * (lib/builder-presence builderUpdateNote).
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
