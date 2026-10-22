import { PageLayout } from "@/components/ui/page-layout";
import { MissionsBoard } from "@/components/missions/MissionsBoard";
import { requirePageUserId } from "@/lib/session";
import { getProjects, getProjectsLastDispatch } from "@/db/queries/projects";
import { getGoals, type GoalWithChildren } from "@/db/queries/goals";
import { missionFromProject, type MissionGoalInput } from "@/lib/missions/project-mission";
import { missionAlertFromProject } from "@/lib/missions/mission-board";

export const metadata = { title: "Missions" };
export const dynamic = "force-dynamic";

function flattenGoals(tree: readonly GoalWithChildren[]): GoalWithChildren[] {
  return tree.flatMap((goal) => [goal, ...flattenGoals(goal.children)]);
}

/** A server-only, owner-scoped join. The client receives projections, not raw attrs. */
export default async function MissionsPage() {
  const userId = await requirePageUserId();
  const [projects, goalTree, lastDispatch] = await Promise.all([
    getProjects(userId),
    getGoals(userId),
    getProjectsLastDispatch(userId).catch(() => ({}) as Record<string, string>),
  ]);

  const goalsByProject = new Map<string, MissionGoalInput[]>();
  for (const goal of flattenGoals(goalTree)) {
    if (!goal.entityId) continue;
    const list = goalsByProject.get(goal.entityId) ?? [];
    list.push(goal);
    goalsByProject.set(goal.entityId, list);
  }

  const missions = projects.map((project) => ({
    ...missionFromProject({
      projectId: project.id,
      name: project.name,
      mission: project.attrs.mission,
      nextStep: project.attrs.next_step,
      goals: goalsByProject.get(project.id) ?? [],
    }),
    alert: missionAlertFromProject(project),
    lastDispatchAt: lastDispatch[project.id] ?? null,
  }));

  return (
    <PageLayout title="Missions">
      <MissionsBoard missions={missions} />
    </PageLayout>
  );
}
