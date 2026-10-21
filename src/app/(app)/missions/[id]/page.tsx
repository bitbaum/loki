import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, ClipboardList, MessageSquare, Terminal } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { GoalProgressBar } from "@/components/shared/GoalProgressBar";
import { requirePageUserId } from "@/lib/session";
import { getProjectDossier } from "@/db/queries/project-dossier";
import { missionFromProject } from "@/lib/missions/project-mission";

export const metadata = { title: "Mission control" };
export const dynamic = "force-dynamic";

export default async function MissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requirePageUserId();
  const { id } = await params;
  // Owner/member access is enforced by the same query as the project workspace.
  // A project belonging to another tenant must render 404, never a mission.
  const dossier = await getProjectDossier(userId, id);
  if (!dossier) notFound();

  const project = dossier.detail.project;
  const attrs = dossier.detail.attrs;
  const mission = missionFromProject({
    projectId: project.id,
    name: project.name,
    mission: attrs.mission,
    nextStep: attrs.next_step,
    goals: dossier.detail.linkedGoals,
  });
  const runHistory = dossier.runs.slice(0, 5);
  const latest = [...(dossier.detail.devLog ?? [])].reverse()[0] ?? null;

  return (
    <PageLayout
      title={mission.name}
      subtitle="Mission control — goals, actions and the evidence behind progress."
      maxWidth="max-w-5xl"
      back={{ href: "/missions", label: "All missions" }}
      right={
        <Link
          href={`/projects/${id}#plan`}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent-text hover:underline"
        >
          Project workspace <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section className="min-w-0 rounded-xl border border-border-subtle p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">Objective</p>
          <p className="mt-3 text-lg leading-relaxed text-text-primary">
            {mission.statement ?? "No mission statement has been written for this project yet."}
          </p>
          {!mission.statement && (
            <Link href={`/projects/${id}#context`} className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm text-accent-text hover:underline">
              Add an objective in Context <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
          <div className="mt-6 border-t border-border-subtle pt-4">
            <p className="text-xs text-text-tertiary">Next action</p>
            <p className="mt-1 text-sm font-medium text-text-primary">
              {mission.nextObjective ?? "Write a next step or add a goal to the project plan."}
            </p>
          </div>
        </section>
        <section aria-label="Reported goal progress" className="rounded-xl border border-border-subtle p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">Goal progress</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums text-text-primary">
            {mission.reportedProgress === null ? "—" : `${mission.reportedProgress}%`}
          </p>
          <p className="mt-2 text-xs text-text-secondary">
            {mission.goalsReportedDone} of {mission.goalsTotal} goals marked done
          </p>
          {mission.reportedProgress !== null && (
            <div className="mt-3"><GoalProgressBar value={mission.reportedProgress} /></div>
          )}
          <p className="mt-4 text-xs leading-relaxed text-text-tertiary">
            Progress is self-reported in Goals. A completed checkbox is not proof of
            an independent test, delivery or deployment.
          </p>
        </section>
      </div>

      <section aria-labelledby="mission-roadmap-title" className="rounded-xl border border-border-subtle p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="mission-roadmap-title" className="flex items-center gap-2 text-base font-semibold text-text-primary">
            <ClipboardList className="h-4 w-4 text-accent-text" aria-hidden /> Roadmap
          </h2>
          <Link href={`/projects/${id}#plan`} className="inline-flex min-h-11 items-center gap-2 text-sm text-accent-text hover:underline">
            Open plan <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        {mission.objectives.length === 0 ? (
          <p className="mt-4 text-sm text-text-secondary">
            No goals yet. Use the existing project plan to define the steps toward this mission.
          </p>
        ) : (
          <ol className="mt-4 divide-y divide-border-subtle">
            {mission.objectives.map((goal, index) => {
              const openMilestones = (goal.milestones ?? []).filter((step) => !step.done);
              return (
                <li key={goal.id} className="flex gap-3 py-4">
                  <span className="shrink-0 text-xs tabular-nums text-text-tertiary">{index + 1}.</span>
                  {goal.reportedDone
                    ? <CheckCircle2 className="h-5 w-5 shrink-0 text-status-positive" aria-label="Reported complete" />
                    : <Circle className="h-5 w-5 shrink-0 text-text-tertiary" aria-label="Not reported complete" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold text-text-primary">{goal.title}</h3>
                      <span className="text-xs tabular-nums text-text-secondary">
                        {goal.reportedDone ? "Reported done" : `${goal.progress ?? 0}% reported`}
                      </span>
                    </div>
                    {goal.description && <p className="mt-1 text-sm text-text-secondary">{goal.description}</p>}
                    {openMilestones.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-text-tertiary">
                        {openMilestones.slice(0, 3).map((step, i) => <li key={i}>• {step.title}</li>)}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-labelledby="mission-evidence-title" className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border-subtle p-5">
          <h2 id="mission-evidence-title" className="text-base font-semibold text-text-primary">Latest handoff</h2>
          {latest ? (
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="text-xs text-text-tertiary">Reported work</dt><dd className="mt-1 whitespace-pre-wrap text-text-primary">{latest.done || "Not recorded"}</dd></div>
              <div><dt className="text-xs text-text-tertiary">Next</dt><dd className="mt-1 whitespace-pre-wrap text-text-primary">{latest.next || "Not recorded"}</dd></div>
              <div><dt className="text-xs text-text-tertiary">Test evidence (as reported)</dt><dd className="mt-1 whitespace-pre-wrap text-text-secondary">{latest.tests || "No test report attached"}</dd></div>
            </dl>
          ) : <p className="mt-3 text-sm text-text-secondary">No agent handoff recorded yet.</p>}
        </div>
        <div className="rounded-xl border border-border-subtle p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
            <Terminal className="h-4 w-4 text-accent-text" aria-hidden /> Recent agent runs
          </h2>
          {runHistory.length === 0 ? (
            <p className="mt-3 text-sm text-text-secondary">No agent run recorded for this project.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border-subtle">
              {runHistory.map((run) => (
                <li key={run.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                  <span className="text-text-primary">
                    {run.finishedAt ? (run.outcome ?? "Finished — no outcome") : "Running or queued"}
                  </span>
                  <time className="shrink-0 text-xs text-text-tertiary" dateTime={run.startedAt.toISOString()}>
                    {run.startedAt.toLocaleDateString("en-CH")}
                  </time>
                </li>
              ))}
            </ul>
          )}
          <Link href="/terminal" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm text-accent-text hover:underline">
            Inspect sessions <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>

      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/loki" className="inline-flex min-h-11 items-center gap-2 font-medium text-accent-text hover:underline">
          <MessageSquare className="h-4 w-4" aria-hidden /> Talk to Loki
        </Link>
        <Link href={`/projects/${id}#now`} className="inline-flex min-h-11 items-center gap-2 text-text-secondary hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Review current blockers
        </Link>
      </div>
      <p className="text-xs text-text-tertiary">
        No new execution authority is granted by this screen. Agents, Crew, spending,
        publication and robots continue to require their existing approvals.
      </p>
    </PageLayout>
  );
}
