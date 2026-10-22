"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { List, ListRow, ListSearch } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import { ChoiceMenu } from "@/components/ui/choice-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { filterGoalTree } from "@/lib/goal-search";
import { projectTitle } from "@/lib/project-display";
import type { GoalWithChildren } from "@/db/queries/goals";
import { GoalRing } from "./GoalRing";
import { goalLine, goalProgress } from "./goal-line";

type SortMode = "default" | "due" | "stuck" | "progress";

const SORT_OPTIONS = [
  { value: "default", label: "As added" },
  { value: "due", label: "Due soonest" },
  { value: "stuck", label: "Least done" },
  { value: "progress", label: "Most done" },
] as const satisfies readonly { value: SortMode; label: string }[];

const ALL = "__all";

function sortGoals(goals: GoalWithChildren[], mode: SortMode): GoalWithChildren[] {
  if (mode === "default") return goals;
  return [...goals].sort((a, b) => {
    if (mode === "due") {
      if (!a.targetDate && !b.targetDate) return 0;
      if (!a.targetDate) return 1;
      if (!b.targetDate) return -1;
      return new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime();
    }
    if (mode === "stuck") return (a.progress ?? 0) - (b.progress ?? 0);
    return (b.progress ?? 0) - (a.progress ?? 0);
  });
}

/**
 * /goals — every goal as one row: a ring for how far along it is, its title,
 * one line (due, milestones, sub-goals, project) and the percentage. A row
 * opens the goal's own page, where everything about it is edited; the list is
 * for seeing where you stand. Design reset rules 3 and 7: rows, and the sort
 * and project filter are menus, not chip rows cut off at the edge.
 */
export function GoalsList({
  activeGoals,
  completedGoals,
  abandonedGoals,
}: {
  activeGoals: GoalWithChildren[];
  completedGoals: GoalWithChildren[];
  abandonedGoals: GoalWithChildren[];
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("default");
  const [project, setProject] = useState<string>(ALL);
  const [showClosed, setShowClosed] = useState(false);

  const projects = useMemo(() => {
    const names = activeGoals.map((g) => g.entityName).filter((n): n is string => !!n);
    return [...new Set(names)].sort();
  }, [activeGoals]);

  const q = query.trim();
  const byProject =
    project === ALL ? activeGoals : activeGoals.filter((g) => g.entityName === project);
  const active = sortGoals(filterGoalTree(byProject, q), sort);
  const closed = [...filterGoalTree(completedGoals, q), ...filterGoalTree(abandonedGoals, q)];
  const total = activeGoals.length + completedGoals.length + abandonedGoals.length;

  return (
    <>
      {total > 6 && <ListSearch value={query} onChange={setQuery} placeholder="Search goals" />}

      <Section
        title="Working on"
        right={
          activeGoals.length > 1 ? (
            <div className="flex items-center gap-3">
              {projects.length > 1 && (
                <ChoiceMenu
                  label="Project"
                  value={project}
                  options={[
                    { value: ALL, label: "All" },
                    ...projects.map((p) => ({
                      value: p,
                      label: projectTitle({
                        name: p,
                        title: activeGoals.find((g) => g.entityName === p)?.entityTitle,
                      }),
                    })),
                  ]}
                  onChange={setProject}
                />
              )}
              <ChoiceMenu label="Sort" value={sort} options={SORT_OPTIONS} onChange={setSort} />
            </div>
          ) : undefined
        }
      >
        {active.length > 0 ? (
          <GoalRows goals={active} />
        ) : q || project !== ALL ? (
          <EmptyState
            icon={Search}
            size="sm"
            title="No goal matches"
            action={
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setProject(ALL);
                }}
                className="ui-btn-secondary"
              >
                Show every goal
              </button>
            }
          />
        ) : (
          <EmptyState>Nothing open. Every goal here is finished or set aside.</EmptyState>
        )}
      </Section>

      {closed.length > 0 && (
        <Section
          title={`Finished or set aside · ${closed.length}`}
          right={
            <button
              type="button"
              onClick={() => setShowClosed((v) => !v)}
              className="ui-section-link"
              aria-expanded={showClosed || !!q}
            >
              {showClosed || q ? "Hide" : "Show"}
            </button>
          }
        >
          {(showClosed || !!q) && <GoalRows goals={closed} />}
        </Section>
      )}
    </>
  );
}

export function GoalRows({ goals }: { goals: GoalWithChildren[] }) {
  return (
    <List aria-label="Goals">
      {goals.map((goal) => {
        const line = goalLine(goal);
        const progress = goalProgress(goal);
        return (
          <ListRow
            key={goal.id}
            href={`/goals/${goal.id}`}
            avatar={<GoalRing value={progress} done={progress >= 100} />}
            title={goal.title}
            secondary={line.text}
            status={line.overdue ? "warning" : undefined}
            trailing={`${progress}%`}
            chevron
          />
        );
      })}
    </List>
  );
}
