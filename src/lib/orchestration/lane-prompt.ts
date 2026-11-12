import { FLEET_SESSIONS_DISPLAY_PATH } from "@/lib/session-paths";
import { exitContractFor } from "@/lib/agent-config";
import { EXIT_CONTRACT_PATTERN } from "@/lib/exit-contract";

/**
 * The dispatch prompt re-pointed at a parallel lane's own session file.
 *
 * Pure, and kept apart from parallel-run.ts (which touches the database) so it
 * is testable without one.
 *
 * REPLACES the exit contract, never appends a second one. A prompt from
 * inject-core already ends with a contract for the BASE tab's file, and the
 * path in that contract is the run's identity to the close path: an agent told
 * to write both files would also report ready on the base tab, which closes
 * whichever run owns that tab — not this one.
 */
export function promptForLane(prompt: string, tab: string): string {
  const body = prompt.replace(EXIT_CONTRACT_PATTERN, "").trimEnd();
  return `${body}\n\n${exitContractFor(`${FLEET_SESSIONS_DISPLAY_PATH}/${tab}.md`)}`;
}

/**
 * The prompt for a fresh one-off session: the lane's exit contract, under a
 * first line that says what this session is. The agent starts with no earlier
 * conversation; the line is there so it does not go looking for one in the
 * project's notes and pick up somebody else's plan.
 */
export const ONE_OFF_SESSION_NOTE =
  "This is a one-off session for the single request below. Do that request and nothing else: do not continue earlier plans or open tasks of this project. When it is done, write the handoff and stop; this session is closed afterwards.";

export function promptForOneOff(prompt: string, tab: string): string {
  return promptForLane(`${ONE_OFF_SESSION_NOTE}\n\n${prompt}`, tab);
}
