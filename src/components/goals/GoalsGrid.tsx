"use client";

import { useState, useMemo } from "react";
import { Search, Target } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GoalCard } from "./GoalCard";
import { CompletedGoals } from "./CompletedGoals";
import { AbandonedGoals } from "./AbandonedGoals";
import type { GoalWithChildren } from "@/db/queries/goals";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { filterGoalTree } from "@/lib/goal-search";

/** Filter tree to goals linked to a specific project (entityName match) */
function filterByProject(goals: GoalWithChildren[], project: string): GoalWithChildren[] {
  return goals.filter((g) => g.entityName === project);
}

/** Count all goals recursively (root + all sub-goals) */
function countGoals(goals: GoalWithChildren[]): number {
  return goals.reduce((sum, g) => sum + 1 + countGoals(g.children), 0);
}

type SortMode = "default" | "due" | "stuck" | "progress";

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "due", label: "Due soon" },
  { value: "stuck", label: "Stuck first" },
  { value: "progress", label: "Most done" },
];

function sortGoals(goals: GoalWithChildren[], mode: SortMode): GoalWithChildren[] {
  if (mode === "default") return goals;
  return [...goals].sort((a, b) => {
    if (mode === "due") {
      // nulls last
      if (!a.targetDate && !b.targetDate) return 0;
      if (!a.targetDate) return 1;
      if (!b.targetDate) return -1;
      return a.targetDate.getTime() - b.targetDate.getTime();
    }
    if (mode === "stuck") {
      return (a.progress ?? 0) - (b.progress ?? 0);
    }
    // progress descending
    return (b.progress ?? 0) - (a.progress ?? 0);
  });
}

type SupportingHabits = Record<string, { id: string; title: string }[]>;

export function GoalsGrid({
  activeGoals,
  completedGoals,
  abandonedGoals,
  habitsByGoalId = {},
}: {
  activeGoals: GoalWithChildren[];
  completedGoals: GoalWithChildren[];
  abandonedGoals: GoalWithChildren[];
  habitsByGoalId?: SupportingHabits;
}) {
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("default");

  useEscapeKey(() => {
    setQuery("");
    setProjectFilter(null);
    setSort("default");
  });

  const projects = useMemo(() => {
    const names = activeGoals.map((g) => g.entityName).filter((n): n is string => !!n);
    return [...new Set(names)].sort();
  }, [activeGoals]);

  const q = query.trim();
  const byProject = projectFilter ? filterByProject(activeGoals, projectFilter) : activeGoals;
  const filteredActive = sortGoals(filterGoalTree(byProject, q), sort);
  const filteredCompleted = filterGoalTree(completedGoals, q);
  const totalActive = countGoals(activeGoals);
  const matchCount = countGoals(filteredActive);
  const isFiltered = !!q || !!projectFilter;

  return (
    <>
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search goals…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="ui-input pl-10 pr-14"
        />
        <span className="ui-badge absolute right-3 top-1/2 -translate-y-1/2">
          {isFiltered ? `${matchCount} / ${totalActive}` : totalActive}
        </span>
      </div>

      {/* Sort chips */}
      <div className="ui-filter-chip-row ui-scroll-fade-right">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setSort(opt.value)}
            className={sort === opt.value ? "ui-chip-filter-active" : "ui-chip-filter"}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Project filter chips */}
      {projects.length > 1 && (
        <div className="ui-filter-chip-row ui-scroll-fade-right">
          {projects.map((name) => (
            <button
              key={name}
              onClick={() => setProjectFilter(projectFilter === name ? null : name)}
              className={projectFilter === name ? "ui-chip-filter-active" : "ui-chip-filter"}
            >
              {name}
            </button>
          ))}
          {projectFilter && (
            <button onClick={() => setProjectFilter(null)} className="ui-chip-filter">
              Clear
            </button>
          )}
        </div>
      )}

      {/* Active goals */}
      {filteredActive.length > 0 ? (
        <div className="space-y-3">
          {filteredActive.map((goal) => (
            <GoalCard key={goal.id} goal={goal} depth={0} habitsByGoalId={habitsByGoalId} />
          ))}
        </div>
      ) : isFiltered && activeGoals.length > 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-6">
            <Target className="h-8 w-8 text-text-tertiary" />
            <div className="text-sm text-text-secondary">
              No active goals match the current filter
            </div>
          </div>
        </Card>
      ) : activeGoals.length === 0 && completedGoals.length > 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-6">
            <Target className="h-8 w-8 text-text-tertiary" />
            <div className="text-sm text-text-secondary">All goals completed</div>
          </div>
        </Card>
      ) : null}

      <CompletedGoals goals={filteredCompleted} />
      <AbandonedGoals goals={filterGoalTree(abandonedGoals, q)} />
    </>
  );
}
