/**
 * The steps a dispatch card shows (run-milestones.ts): while the build runs,
 * and still after it ends, so whoever opens the chat later can read what
 * happened instead of a bare "Completed" (the owner, 2026-10-15: "I cannot
 * follow it, and I cannot know if it was made or not"). After the run, the
 * card's follow line carries on from here: merged, live, Loki's look.
 */
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import { getGithubToken } from "@/lib/github-token";
import { buildRunMilestones, type RunMilestone } from "@/lib/run-milestones";
import { fetchRepoProgress } from "@/lib/run-milestones-fetch";
import { FOLLOW_WINDOW_MS } from "@/lib/run-follow";

export async function loadRunMilestones(
  userId: string,
  run: {
    id: string;
    projectId: string | null;
    startedAt: Date;
    finishedAt: Date | null;
    outcome: string | null;
  },
  pickedUpAt: Date | string | null,
  now: number = Date.now(),
): Promise<RunMilestone[] | null> {
  if (now - (run.finishedAt ?? run.startedAt).getTime() > FOLLOW_WINDOW_MS) return null;
  const [project, token] = await Promise.all([
    run.projectId ? getUserProjectByEntityId(userId, run.projectId).catch(() => null) : null,
    getGithubToken(userId).catch(() => null),
  ]);
  const repo =
    project?.gitUrl && token
      ? await fetchRepoProgress(run.id, project.gitUrl, token, run.startedAt.getTime(), now)
      : null;
  return buildRunMilestones({
    startedAt: pickedUpAt,
    repo,
    finished: run.finishedAt ? { at: run.finishedAt, outcome: run.outcome } : null,
  });
}
