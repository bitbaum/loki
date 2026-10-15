/**
 * The milestones a dispatch card shows while its build is still going
 * (run-milestones.ts). Only for a run that is open and recent: a finished run
 * has its own account (run-handoff) and its way to the live site (run-follow).
 */
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import { getGithubToken } from "@/lib/github-token";
import { buildRunMilestones, type RunMilestone } from "@/lib/run-milestones";
import { fetchRepoProgress } from "@/lib/run-milestones-fetch";

const WATCH_FOR_MS = 6 * 60 * 60_000;

export async function loadRunMilestones(
  userId: string,
  run: { id: string; projectId: string | null; startedAt: Date; finishedAt: Date | null },
  pickedUpAt: Date | string | null,
  now: number = Date.now(),
): Promise<RunMilestone[] | null> {
  if (run.finishedAt || now - run.startedAt.getTime() > WATCH_FOR_MS) return null;
  const [project, token] = await Promise.all([
    run.projectId ? getUserProjectByEntityId(userId, run.projectId).catch(() => null) : null,
    getGithubToken(userId).catch(() => null),
  ]);
  const repo =
    project?.gitUrl && token
      ? await fetchRepoProgress(run.id, project.gitUrl, token, run.startedAt.getTime(), now)
      : null;
  return buildRunMilestones({ startedAt: pickedUpAt, repo });
}
