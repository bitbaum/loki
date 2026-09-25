import { FLEET_SESSIONS_DISPLAY_PATH } from "@/lib/session-paths";
import { EXIT_CONTRACT_PATTERN, exitContractFor } from "@/lib/agent-config";

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
