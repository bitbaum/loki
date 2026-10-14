import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { orchestrationRuns } from "@/db/schema/orchestration-runs";
import { getDayCatalog, getDayPreferences } from "./catalog";
import { getProjectStatesByUserId } from "@/db/queries/project-states";
import { isProjectBusy } from "@/db/queries/orchestration-runs";
import { hasOpenPendingForProject } from "@/db/queries/pending-commands";
import { loadProjectOverrides } from "@/lib/fleet-kick";
import { getGithubToken } from "@/lib/github-token";
import { fetchRecentGithubCommits } from "@/lib/github-commits";
import { coldStartWorkspaceDir } from "@/lib/execution-access";
import { NAV } from "@/config/navigation";
import { rankDayProjects, type DayPlan, type DayProjectInput } from "./rank";

export async function loadDayPlan(userId: string): Promise<DayPlan> {
  const [projects, preferences] = await Promise.all([
    getDayCatalog(userId),
    getDayPreferences(userId),
  ]);
  const mainProjects = projects.filter((p) => preferences.mainProjectIds.includes(p.id));
  const owners = [...new Set(mainProjects.map((p) => p.userId))];
  const ownerData = new Map(
    await Promise.all(
      owners.map(async (ownerId) => {
        const [states, overrides, runs, token] = await Promise.all([
          getProjectStatesByUserId(ownerId),
          loadProjectOverrides(ownerId),
          // One row per project, so a busy repo cannot crowd the others out of a
          // globally limited recent-runs query. Undelivered requests are not work.
          db
            .select({
              key: sql<string>`lower(${orchestrationRuns.projectKey})`,
              at: sql<string>`max(${orchestrationRuns.payload}->>'deliveredAt')`,
            })
            .from(orchestrationRuns)
            .where(and(eq(orchestrationRuns.userId, ownerId)))
            .groupBy(sql`lower(${orchestrationRuns.projectKey})`),
          getGithubToken(ownerId).catch(() => null),
        ]);
        return [ownerId, { states, overrides, runs, token }] as const;
      }),
    ),
  );
  let githubChecked = true;
  const inputs = await Promise.all(
    mainProjects.map(async (p): Promise<DayProjectInput> => {
      const { states, overrides, runs, token } = ownerData.get(p.userId)!;
      const stateByKey = new Map(states.map((s) => [s.projectKey.toLowerCase(), s]));
      const runByKey = new Map(runs.map((r) => [r.key, r.at]));

      const key = p.name.toLowerCase();
      const state = stateByKey.get(key);
      const [commits, busy, pending] = await Promise.all([
        token && p.gitUrl ? fetchRecentGithubCommits(p.gitUrl, token, 1) : null,
        isProjectBusy(p.userId, p.name),
        hasOpenPendingForProject(p.userId, p.name),
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
        name: preferences.labels[p.id] || p.displayName,
        main: preferences.mainProjectIds.includes(p.id),
        accessReason: p.canStart ? undefined : "View only — a builder or owner can start work",
        href: p.entityProjectId ? `${NAV.projects.href}/${p.entityProjectId}` : NAV.control.href,
        runnable: Boolean(p.dirPath || coldStartWorkspaceDir(p.name, p.gitUrl)),
        paused: overrides.get(key) === "off",
        busy: busy || pending,
        activity,
      };
    }),
  );
  const ranked = rankDayProjects(inputs);
  const catalog = projects
    .map((p) => ({
      id: p.id,
      name: preferences.labels[p.id] || p.displayName,
      href: p.entityProjectId ? `${NAV.projects.href}/${p.entityProjectId}` : NAV.control.href,
      main: preferences.mainProjectIds.includes(p.id),
      lastActiveAt: "",
      why: p.canStart ? "" : "View only — a builder or owner can start work",
      unavailable: p.canStart ? null : "View only — a builder or owner can start work",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    ...ranked,
    catalog,
    labels: Object.fromEntries(
      Object.entries(preferences.labels).filter(([id]) => projects.some((p) => p.id === id)),
    ),
    githubChecked,
  };
}
