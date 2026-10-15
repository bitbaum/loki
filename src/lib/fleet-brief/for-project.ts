/**
 * Full fleet reference text for a project key.
 *
 * Kept apart from ./brief.ts so the pure half stays importable with no
 * database. Routine dispatch assemblers intentionally do not call this helper:
 * the entire stack/package catalog buried each task in unrelated context.
 */
import { getProjectGitUrlByKey } from "@/db/queries/user-projects";
import { fleetBriefForRepo } from "./brief";

/** "" when the project is not in the fleet's org, has no repo, or the lookup fails. */
export async function fleetBriefForProject(userId: string, projectKey: string): Promise<string> {
  const gitUrl = await getProjectGitUrlByKey(userId, projectKey).catch(() => null);
  return fleetBriefForRepo(gitUrl).catch(() => "");
}
