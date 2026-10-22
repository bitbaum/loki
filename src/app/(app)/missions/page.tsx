import Link from "next/link";
import { ArrowRight, CheckCircle2, Compass, FolderKanban, Plus, Target } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { GoalProgressBar } from "@/components/shared/GoalProgressBar";
import { requirePageUserId } from "@/lib/session";
import { getProjects, getProjectsLastDispatch } from "@/db/queries/projects";
import { getGoals, type GoalWithChildren } from "@/db/queries/goals";
import { missionFromProject, type MissionGoalInput } from "@/lib/missions/project-mission";

export const metadata = { title: "Missions" };
export const dynamic = "force-dynamic";

const phaseLabel = {
  "needs-objective": "Define objective",
  ready: "Ready to plan",
  "in-progress": "Progress reported",
  "reported-complete": "Goals reported done",
} as const;

function flattenGoals(tree: readonly GoalWithChildren[]): GoalWithChildren[] {
  return tree.flatMap((goal) => [goal, ...flattenGoals(goal.children)]);
}

export default async function MissionsPage() {
  const userId = await requirePageUserId();
  const [projects, goalTree, lastDispatch] = await Promise.all([
    getProjects(userId),
    getGoals(userId),
    getProjectsLastDispatch(userId).catch(() => ({}) as Record<string, string>),
  ]);
  // The same entity ID that Projects/Goals already use. No new mission rows.
  const goalsByProject = new Map<string, MissionGoalInput[]>();
  for (const goal of flattenGoals(goalTree)) {
    if (!goal.entityId) continue;
    const list = goalsByProject.get(goal.entityId) ?? [];
    list.push(goal);
    goalsByProject.set(goal.entityId, list);
  }

  const missions = projects.map((project) =>
    missionFromProject({
      projectId: project.id,
      name: project.name,
      mission: project.attrs.mission,
      nextStep: project.attrs.next_step,
      goals: goalsByProject.get(project.id) ?? [],
    }),
  );
  const withObjective = missions.filter((mission) => Boolean(mission.statement)).length;
  const withRoadmap = missions.filter((mission) => mission.goalsTotal > 0).length;

  return (
    <PageLayout
      title="Missions"
      subtitle="Choose an objective. Follow the work. See what actually happened."
      maxWidth="max-w-5xl"
      right={
        <Link
          href="/projects?new=1"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border-subtle px-3 text-sm font-medium text-text-primary hover:bg-surface-overlay"
        >
          <Plus className="h-4 w-4" aria-hidden />
          New project
        </Link>
      }
    >
      <section aria-label="Mission overview" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border-subtle p-4">
          <p className="text-xs text-text-tertiary">Projects</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
            {missions.length}
          </p>
        </div>
        <div className="rounded-xl border border-border-subtle p-4">
          <p className="text-xs text-text-tertiary">Objectives stated</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
            {withObjective}
          </p>
        </div>
        <div className="col-span-2 rounded-xl border border-border-subtle p-4 sm:col-span-1">
          <p className="text-xs text-text-tertiary">With roadmaps</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
            {withRoadmap}
          </p>
        </div>
      </section>

      <p className="text-sm text-text-secondary">
        These missions are views of your existing projects. Progress comes from your saved Goals; it
        is <strong>reported progress, not independent verification</strong>. Agent runs and
        deliverables keep their own evidence in the project workspace.
      </p>

      {missions.length === 0 ? (
        <div className="rounded-xl border border-border-subtle px-5 py-12 text-center">
          <Compass className="mx-auto h-8 w-8 text-text-tertiary" aria-hidden />
          <h2 className="mt-4 text-lg font-semibold text-text-primary">
            Your first mission starts with a project
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-text-secondary">
            Create a project, state what success looks like, then build a roadmap. Loki will display
            its actual progress here.
          </p>
          <Link
            href="/projects?new=1"
            className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent-text hover:underline"
          >
            Create project <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      ) : (
        <section aria-label="Your missions" className="grid gap-4 md:grid-cols-2">
          {missions.map((mission) => (
            <article
              key={mission.projectId}
              className="flex min-w-0 flex-col rounded-xl border border-border-subtle p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text-tertiary">
                    {phaseLabel[mission.phase]}
                  </p>
                  <h2 className="mt-1 break-words text-lg font-semibold text-text-primary">
                    {mission.name}
                  </h2>
                </div>
                <Target className="h-5 w-5 shrink-0 text-accent-text" aria-hidden />
              </div>
              <p className="mt-3 line-clamp-3 text-sm text-text-secondary">
                {mission.statement ?? "No mission statement yet. Add it to the project Context."}
              </p>
              <div className="mt-5 space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-text-secondary">
                    {mission.goalsTotal
                      ? `${mission.goalsReportedDone} of ${mission.goalsTotal} goals reported done`
                      : "No roadmap goals yet"}
                  </span>
                  {mission.reportedProgress !== null && (
                    <span className="tabular-nums text-text-primary">
                      {mission.reportedProgress}% reported
                    </span>
                  )}
                </div>
                {mission.reportedProgress !== null && (
                  <GoalProgressBar value={mission.reportedProgress} />
                )}
              </div>
              <div className="mt-4 min-h-12 border-t border-border-subtle pt-3">
                <p className="text-xs text-text-tertiary">Next objective</p>
                <p className="mt-1 line-clamp-2 text-sm text-text-primary">
                  {mission.nextObjective ?? "Define a next step in your project plan"}
                </p>
              </div>
              {lastDispatch[mission.projectId] && (
                <p className="mt-2 text-xs text-text-muted">
                  Last agent dispatch:{" "}
                  {new Date(lastDispatch[mission.projectId]).toLocaleDateString("en-CH")} — not
                  proof of completion
                </p>
              )}
              <div className="mt-auto flex flex-wrap gap-4 border-t border-border-subtle pt-4">
                <Link
                  href={`/missions/${mission.projectId}`}
                  className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent-text hover:underline"
                >
                  Open mission <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link
                  href={`/projects/${mission.projectId}#plan`}
                  className="inline-flex min-h-11 items-center gap-1.5 text-sm text-text-secondary hover:underline"
                >
                  <FolderKanban className="h-4 w-4" aria-hidden /> Edit roadmap
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}
      <p className="flex items-start gap-2 text-xs text-text-tertiary">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Missions do not launch agents, contact people, move money or publish items without the
        separate permissions already required by those systems.
      </p>
    </PageLayout>
  );
}
