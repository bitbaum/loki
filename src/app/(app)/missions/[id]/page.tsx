import { notFound } from "next/navigation";
import { CheckCircle2, Circle, Flag, MessageSquare, ShieldAlert, Target } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { List, ListRow } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import { requirePageUserId } from "@/lib/session";
import { getProjectDossier } from "@/db/queries/project-dossier";
import { goalsLine, missionFromProject } from "@/lib/missions/project-mission";
import { missionRunRow } from "@/lib/missions/run-row";
import { HandoffText } from "@/components/missions/HandoffText";
import { MissionContinueAction } from "@/components/missions/MissionContinueAction";
import { missionContinueOffer } from "@/lib/missions/continue-offer";
import { getProjectAccess } from "@/db/queries/project-access";
import { deriveBuildStatus } from "@/lib/project-build-status";
import { answer, cleanDescription, plainWords, projectTitle } from "@/lib/project-display";
import { factReachesAgent } from "@/lib/project-signals";

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
  // Same ownership and capability decision as POST /api/projects/[id]/dispatch.
  const access = await getProjectAccess(userId, id);
  const buildStatus = deriveBuildStatus({
    state: dossier.state,
    runs: dossier.runs,
    commits: dossier.commits,
    nowMs: dossier.builtAtMs,
  });
  const fromHandoff = answer(latest?.next);
  const fromAttr = answer(attrs.next_step);
  const nextStep =
    fromHandoff ||
    (fromAttr && factReachesAgent(fromAttr, dossier.detail.attrMeta?.next_step?.source ?? null)
      ? fromAttr
      : null);
  const offer = missionContinueOffer({
    canEdit: Boolean(access?.canEdit && access.ownerUserId === dossier.ownerId),
    buildStatus: buildStatus.kind,
    hasRepo: Boolean(dossier.userProject?.gitUrl ?? project.gitUrl),
    hasQueuedNextStep: Boolean(nextStep),
    hasBriefOrGoals: Boolean(
      cleanDescription(project.description) || dossier.detail.linkedGoals.length,
    ),
  });

  const title = projectTitle({ name: mission.name });
  // One progress measure (goalsLine): "4 of 14 goals reported done · 54%"
  // put two numbers that disagree on one line (2026-11-12).
  const progressLine =
    mission.goalsTotal > 0 ? goalsLine(mission.goalsReportedDone, mission.goalsTotal) : null;
  // One answer to "what is next": the handoff's, else the project's own
  // next step, else the first open goal. The page showed the project's next
  // step under "Next move" and the handoff's different one further down.
  const nextMove = nextStep ?? mission.nextObjective;
  const handoffNext = latest?.next?.trim() || null;

  return (
    <PageLayout title={title} back={{ href: "/missions", label: "Missions" }}>
      <Section title="Objective">
        {mission.statement ? (
          <p className="text-base leading-relaxed text-text-primary">{mission.statement}</p>
        ) : (
          <List aria-label="Objective">
            <ListRow
              href={`/projects/${id}#context`}
              icon={Target}
              title="Write what success means"
              secondary="No objective yet"
              chevron
            />
          </List>
        )}
        {progressLine && <p className="mt-2 text-sm text-text-secondary">{progressLine}</p>}
      </Section>

      <Section title="Next move">
        {nextMove ? (
          <p className="text-base leading-relaxed text-text-primary">{plainWords(nextMove)}</p>
        ) : (
          <List aria-label="Next move">
            <ListRow
              href={`/projects/${id}#plan`}
              icon={Flag}
              title="Write a next step or add a goal"
              chevron
            />
          </List>
        )}
        <div className="mt-3">
          <MissionContinueAction
            projectId={id}
            workspaceKey={dossier.userProject?.name ?? project.name}
            offer={offer}
          />
        </div>
      </Section>

      <Section title="Roadmap" link={{ href: `/projects/${id}#plan`, label: "Open plan" }}>
        {mission.objectives.length === 0 ? (
          <p className="text-sm text-text-secondary">No goals yet.</p>
        ) : (
          <List aria-label="Roadmap">
            {mission.objectives.map((goal) => {
              const open = (goal.milestones ?? []).filter((step) => !step.done);
              return (
                <ListRow
                  key={goal.id}
                  icon={goal.reportedDone ? CheckCircle2 : Circle}
                  title={goal.title}
                  secondary={open[0]?.title ?? goal.description ?? undefined}
                  trailing={goal.reportedDone ? "Done" : `${goal.progress ?? 0}%`}
                />
              );
            })}
          </List>
        )}
      </Section>

      <Section title="Latest handoff">
        {latest ? (
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-text-tertiary">What was done</dt>
              <dd className="mt-0.5 text-text-primary">
                <HandoffText text={latest.done ? plainWords(latest.done) : "Not recorded"} />
              </dd>
            </div>
            {/* Shown only when it says something the next move does not. */}
            {handoffNext && answer(handoffNext) !== nextMove && (
              <div>
                <dt className="text-text-tertiary">The agent&apos;s own note on what is next</dt>
                <dd className="mt-0.5 text-text-primary">
                  <HandoffText text={plainWords(handoffNext)} />
                </dd>
              </div>
            )}
            {latest.tests && (
              <div>
                <dt className="text-text-tertiary">Tests, as the agent reported them</dt>
                <dd className="mt-0.5 text-text-secondary">
                  <HandoffText text={plainWords(latest.tests)} />
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-sm text-text-secondary">No agent handoff yet.</p>
        )}
      </Section>

      <Section title="Recent runs" link={{ href: `/projects/${id}/watch`, label: "Watch live" }}>
        {runHistory.length === 0 ? (
          <p className="text-sm text-text-secondary">No agent run yet.</p>
        ) : (
          <List aria-label="Recent runs">
            {runHistory.map((run) => {
              const row = missionRunRow(run, id);
              return (
                <ListRow
                  key={run.id}
                  href={row.href}
                  title={row.title}
                  secondary={row.status}
                  status={row.tone}
                  trailing={row.when}
                  chevron
                />
              );
            })}
          </List>
        )}
      </Section>

      <List aria-label="More">
        <ListRow href="/loki" icon={MessageSquare} title="Talk to Loki about it" chevron />
        <ListRow
          href={`/projects/${id}#now`}
          icon={ShieldAlert}
          title="See what is blocking it"
          chevron
        />
      </List>
    </PageLayout>
  );
}
