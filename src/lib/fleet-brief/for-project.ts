/**
 * The fleet brief for a dispatch that names its project by key.
 *
 * Kept apart from ./brief.ts so the pure half stays importable with no
 * database (the tests and the snapshot generator import it). Every dispatch
 * assembler calls this; scripts/test/fleet-brief-reaches-every-dispatch.ts
 * fails when one that builds an agent's prompt does not.
 */
import { getProjectGitUrlByKey } from "@/db/queries/user-projects";
import { fleetBriefForRepo } from "./brief";

/** "" when the project is not in the fleet's org, has no repo, or the lookup fails. */
export async function fleetBriefForProject(userId: string, projectKey: string): Promise<string> {
  const gitUrl = await getProjectGitUrlByKey(userId, projectKey).catch(() => null);
  return fleetBriefForRepo(gitUrl).catch(() => "");
}
