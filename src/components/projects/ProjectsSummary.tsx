"use client";

import { AlertTriangle, ArrowRight, Users, FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectsPageFilter, ProjectsPageStats } from "@/lib/projects-page-stats";

const FILTERS: {
  id: ProjectsPageFilter;
  label: string;
  icon: typeof FolderKanban;
  tone?: "warning";
  count: (stats: ProjectsPageStats) => number;
  hidden?: (stats: ProjectsPageStats) => boolean;
  title?: string;
}[] = [
  { id: null, label: "All", icon: FolderKanban, count: (s) => s.total },
  {
    id: "attention",
    label: "Site issues",
    icon: AlertTriangle,
    tone: "warning",
    count: (s) => s.attention,
    hidden: (s) => s.attention === 0,
    title:
      "Live URL down, or attrs: security_vulnerability / broken_features / deployment_issue. Not a general “needs work” list.",
  },
  {
    id: "next-step",
    label: "Next step",
    icon: ArrowRight,
    count: (s) => s.withNextStep,
    hidden: (s) => s.withNextStep === 0,
  },
  {
    id: "team",
    label: "Team",
    icon: Users,
    count: (s) => s.team,
    hidden: (s) => s.team === 0,
  },
];

export function ProjectsSummary({
  stats,
  activeFilter,
  onFilter,
  resultCount,
  totalCount,
}: {
  stats: ProjectsPageStats;
  activeFilter: ProjectsPageFilter;
  onFilter: (filter: ProjectsPageFilter) => void;
  resultCount: number;
  totalCount: number;
}) {
  const chips = FILTERS.filter((f) => !f.hidden?.(stats));
  const filtered = resultCount !== totalCount || activeFilter !== null;
  // "All" alone is a filter with nothing to choose between — a chip row that
  // only restates the list below it (seen at /projects with three healthy
  // projects, 2026-10-04). The row appears once there is a second lens.
  if (chips.length < 2 && !filtered) return null;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const Icon = chip.icon;
          const active = activeFilter === chip.id;
          const count = chip.count(stats);
          return (
            <button
              key={chip.label}
              type="button"
              onClick={() => onFilter(active ? null : chip.id)}
              aria-pressed={active}
              title={chip.title}
              className={cn(
                "ui-projects-filter-chip",
                active && "ui-projects-filter-chip-active",
                chip.tone === "warning" && !active && count > 0 && "text-status-warning",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{chip.label}</span>
              <span className="ui-projects-filter-count">{count}</span>
            </button>
          );
        })}
      </div>
      {filtered && (
        <p className="shrink-0 text-xs text-text-tertiary">
          <span className="font-medium text-text-secondary">{resultCount}</span> of {totalCount}
        </p>
      )}
    </div>
  );
}
