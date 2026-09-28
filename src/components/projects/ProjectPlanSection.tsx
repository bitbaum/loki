"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus, Target } from "lucide-react";
import type { ProjectDossier } from "@/db/queries/project-dossier";
import { GoalEditor } from "./GoalEditor";
import { AddAttrInline, AttrRow } from "./project-overview-helpers";
import { GoalProgressBar } from "@/components/shared/GoalProgressBar";
import { answer } from "@/lib/project-display";

type LinkedGoal = ProjectDossier["detail"]["linkedGoals"][number];

export function ProjectPlanSection({
  projectId,
  projectName,
  attrs,
  goals,
  readonly,
}: {
  projectId: string;
  projectName: string;
  attrs: Record<string, string>;
  goals: LinkedGoal[];
  readonly: boolean;
}) {
  const router = useRouter();
  const [addingNext, setAddingNext] = useState(false);
  const refresh = () => router.refresh();
  const rawMaxTurns = Number.parseInt(attrs.goal_max_turns ?? "", 10);
  const maxTurns =
    Number.isFinite(rawMaxTurns) && rawMaxTurns > 0 ? Math.min(rawMaxTurns, 20) : null;
  const nextStep = answer(attrs.next_step);
  // Build order, not progress order: creation order is the order the roadmap
  // was written in, and "1, 2, 3" must mean the same thing on every visit.
  const roadmap = [...goals].sort(
    (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
  );
  const doneCount = roadmap.filter((g) => (g.progress ?? 0) >= 100).length;
  const nextGoalId = roadmap.find((g) => (g.progress ?? 0) < 100)?.id ?? null;

  return (
    <section className="ui-project-section" aria-labelledby="project-plan-title">
      <div className="flex items-center gap-2">
        <Target className="h-4 w-4 text-accent-text" aria-hidden="true" />
        <h2 id="project-plan-title" className="text-lg font-semibold text-text-primary">
          Plan
        </h2>
      </div>

      {/* The roadmap first. It was the last block on this tab, under an empty
          "Next action" and a "Completion contract" — the plan itself, the thing
          a person opens Plan to see, was the one part you had to scroll for. */}
      <section className="mt-5">
        <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border-subtle">
          <h3 className="text-sm font-medium text-text-primary">
            Roadmap
            {roadmap.length > 0 && (
              <span className="ml-2 font-normal text-text-tertiary">
                {doneCount} of {roadmap.length} done
              </span>
            )}
          </h3>
          <Link
            href="/goals"
            className="inline-flex min-h-11 items-center gap-1 text-sm text-accent-text hover:underline"
          >
            Edit in Goals <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
        {roadmap.length > 0 ? (
          <ol className="divide-y divide-border-subtle">
            {roadmap.map((goal, i) => {
              const openMilestones = Array.isArray(goal.milestones)
                ? goal.milestones.filter((milestone) => !milestone.done).slice(0, 3)
                : [];
              const done = (goal.progress ?? 0) >= 100;
              return (
                <li key={goal.id} className="py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h4
                      className={
                        done
                          ? "text-sm font-medium text-text-tertiary"
                          : "text-sm font-medium text-text-primary"
                      }
                    >
                      <span className="mr-2 tabular-nums text-text-muted">{i + 1}.</span>
                      {goal.title}
                      {goal.id === nextGoalId && (
                        <span className="ui-tag ui-tag-neutral ml-2 align-middle">Next</span>
                      )}
                    </h4>
                    <span className="shrink-0 text-xs tabular-nums text-text-muted">
                      {done ? "Done" : `${goal.progress ?? 0}%`}
                    </span>
                  </div>
                  {goal.description && !done && (
                    <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                      {goal.description}
                    </p>
                  )}
                  {!done && (
                    <div className="mt-2">
                      <GoalProgressBar value={goal.progress ?? 0} />
                    </div>
                  )}
                  {openMilestones.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-text-tertiary">
                      {openMilestones.map((milestone) => (
                        <li key={`${milestone.title}:${milestone.date ?? ""}`}>
                          • {milestone.title}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="py-4 text-sm text-text-muted">
            No roadmap yet. Make it happen writes one from the brief.
          </p>
        )}
      </section>

      <div className="mt-7 grid gap-7 lg:grid-cols-2">
        <section>
          <h3 className="ui-projects-section-label mb-1">Next action</h3>
          <div className="border-y border-border-subtle">
            {nextStep ? (
              <AttrRow
                label="Next step"
                value={nextStep}
                projectId={projectId}
                attrKey="next_step"
                placeholder="The single most important next action"
                editable={!readonly}
                onReload={refresh}
              />
            ) : !readonly ? (
              <div className="py-2">
                {addingNext ? (
                  <AddAttrInline
                    projectId={projectId}
                    presetKey="next_step"
                    presetPlaceholder="The single most important next action"
                    onSaved={() => {
                      setAddingNext(false);
                      refresh();
                    }}
                    onCancel={() => setAddingNext(false)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingNext(true)}
                    className="flex min-h-11 w-full items-center gap-2 text-left text-sm text-text-tertiary hover:text-text-primary"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" /> Set the next action
                  </button>
                )}
              </div>
            ) : (
              <p className="py-3 text-sm text-text-muted">No next action is recorded.</p>
            )}
          </div>
        </section>

        <section>
          <h3 className="ui-projects-section-label mb-1">When a run counts as done</h3>
          <dl className="border-y border-border-subtle py-3">
            {readonly ? (
              <div>
                <dt className="text-sm font-medium text-text-primary">Definition of done</dt>
                <dd className="mt-1 text-sm leading-relaxed text-text-secondary">
                  {answer(attrs.definition_of_done) ?? "No completion contract is recorded."}
                </dd>
              </div>
            ) : (
              <GoalEditor
                projectKey={projectName}
                definitionOfDone={attrs.definition_of_done ?? null}
                maxTurns={maxTurns}
              />
            )}
          </dl>
        </section>
      </div>
    </section>
  );
}
