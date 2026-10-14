import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { orchestrationRuns } from "@/db/schema/orchestration-runs";
import { getUserProjects } from "@/db/queries/user-projects";
import { getProjectStatesByUserId } from "@/db/queries/project-states";
import { isProjectBusy } from "@/db/queries/orchestration-runs";
import { hasOpenPendingForProject } from "@/db/queries/pending-commands";
import { loadProjectOverrides } from "@/lib/fleet-kick";
import { getGithubToken } from "@/lib/github-token";
import { fetchRecentGithubCommits } from "@/lib/github-commits";
import { NAV } from "@/config/navigation";
import { rankDayProjects, type DayPlan, type DayProjectInput } from "./rank";

export async function loadDayPlan(userId: string): Promise<DayPlan> {
  const [projects, states, overrides, runs, token] = await Promise.all([
    getUserProjects(userId),
    getProjectStatesByUserId(userId),
    loadProjectOverrides(userId),
    // One row per project, so a busy repo cannot crowd the others out of a
    // globally limited recent-runs query. Undelivered requests are not work.
    db
      .select({
        key: sql<string>`lower(${orchestrationRuns.projectKey})`,
        at: sql<string>`max(${orchestrationRuns.payload}->>'deliveredAt')`,
      })
      .from(orchestrationRuns)
      .where(and(eq(orchestrationRuns.userId, userId)))
      .groupBy(sql`lower(${orchestrationRuns.projectKey})`),
    getGithubToken(userId).catch(() => null),
  ]);
  const stateByKey = new Map(states.map((s) => [s.projectKey.toLowerCase(), s]));
  const runByKey = new Map(runs.map((r) => [r.key, r.at]));
  let githubChecked = Boolean(token);
  const inputs = await Promise.all(
    projects.map(async (p): Promise<DayProjectInput> => {
      const key = p.name.toLowerCase();
      const state = stateByKey.get(key);
      const [commits, busy, pending] = await Promise.all([
        token && p.gitUrl ? fetchRecentGithubCommits(p.gitUrl, token, 1) : null,
        isProjectBusy(userId, p.name),
        hasOpenPendingForProject(userId, p.name),
      ]);
      if (p.gitUrl && commits === null) githubChecked = false;
      const activity: DayProjectInput["activity"] = p.devLog.map((e) => ({
        at: e.date,
        source: "dev log",
      }));
      if (state?.sessionUpdatedAt)
        activity.push({ at: state.sessionUpdatedAt.toISOString(), source: "session" });
      const runAt = runByKey.get(key);
      if (runAt) activity.push({ at: runAt, source: "run" });
      for (const c of commits ?? [])
        activity.push({ at: new Date(c.atMs).toISOString(), source: "commit" });
      return {
        id: p.id,
        name: p.name,
        href: p.entityProjectId ? `${NAV.projects.href}/${p.entityProjectId}` : NAV.control.href,
        runnable: Boolean(p.dirPath),
        paused: overrides.get(key) === "off",
        busy: busy || pending,
        activity,
      };
    }),
  );
  return { ...rankDayProjects(inputs), githubChecked };
}
