"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Compass,
  FolderKanban,
  Search,
  ShieldAlert,
  Target,
} from "lucide-react";
import { GoalProgressBar } from "@/components/shared/GoalProgressBar";
import {
  filterMissionBoard,
  type MissionBoardFilter,
  type MissionBoardItem,
} from "@/lib/missions/mission-board";

const FILTERS: readonly { id: MissionBoardFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs attention" },
  { id: "moving", label: "In progress" },
  { id: "unplanned", label: "Needs a plan" },
  { id: "complete", label: "Reported done" },
];

const PHASE_LABEL = {
  "needs-objective": "Define objective",
  ready: "Ready to plan",
  "in-progress": "Progress reported",
  "reported-complete": "Goals reported done",
} as const;

const INITIAL_ROWS = 12;

function MissionCard({ mission }: { mission: MissionBoardItem }) {
  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-border-subtle p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-tertiary">{PHASE_LABEL[mission.phase]}</p>
          <h2 className="mt-1 break-words text-lg font-semibold text-text-primary">
            {mission.name}
          </h2>
        </div>
        <Target className="h-5 w-5 shrink-0 text-accent-text" aria-hidden />
      </div>

      {mission.alert && (
        <div className="mt-3 border-l-2 border-status-warning pl-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-text-primary">
            <ShieldAlert className="h-4 w-4" aria-hidden /> {mission.alert.label}
          </p>
          <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{mission.alert.detail}</p>
        </div>
      )}

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
        {mission.reportedProgress !== null && <GoalProgressBar value={mission.reportedProgress} />}
      </div>

      <div className="mt-4 min-h-12 border-t border-border-subtle pt-3">
        <p className="text-xs text-text-tertiary">Next objective</p>
        <p className="mt-1 line-clamp-2 text-sm text-text-primary">
          {mission.nextObjective ?? "Define a next step in your project plan"}
        </p>
      </div>

      {mission.lastDispatchAt && (
        <p className="mt-2 text-xs text-text-tertiary">
          Last agent dispatch: {mission.lastDispatchAt.slice(0, 10)} — not proof of completion
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
  );
}

export function MissionsBoard({ missions }: { missions: readonly MissionBoardItem[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MissionBoardFilter>("all");
  const [expanded, setExpanded] = useState(false);

  const displayed = useMemo(
    () => filterMissionBoard(missions, query, filter),
    [missions, query, filter],
  );
  const flagged = displayed.filter((mission) => mission.alert).length;
  const initialCount = Math.max(INITIAL_ROWS, flagged);
  const visible = expanded ? displayed : displayed.slice(0, initialCount);
  const withObjective = missions.filter((mission) => Boolean(mission.statement)).length;
  const withRoadmap = missions.filter((mission) => mission.goalsTotal > 0).length;
  const attentionCount = missions.filter((mission) => mission.alert).length;

  function changeFilter(next: MissionBoardFilter) {
    setFilter(next);
    setExpanded(false);
  }

  return (
    <div className="space-y-5">
      <section aria-label="Mission overview" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { name: "Projects", value: missions.length },
          { name: "Objectives stated", value: withObjective },
          { name: "With roadmaps", value: withRoadmap },
          { name: "Reported site issues", value: attentionCount },
        ].map((stat) => (
          <div key={stat.name} className="rounded-xl border border-border-subtle p-4">
            <p className="text-xs text-text-tertiary">{stat.name}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
              {stat.value}
            </p>
          </div>
        ))}
      </section>

      <p className="text-sm text-text-secondary">
        Missions reflect existing projects and saved Goals. Progress is reported, not independently
        verified. Site flags come from the same live signals as Projects.
      </p>

      {missions.length === 0 ? (
        <div className="rounded-xl border border-border-subtle px-5 py-12 text-center">
          <Compass className="mx-auto h-8 w-8 text-text-tertiary" aria-hidden />
          <h2 className="mt-4 text-lg font-semibold text-text-primary">
            Your first mission starts with a project
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-text-secondary">
            Create a project and write what success means. Your real roadmap will appear here.
          </p>
          <Link
            href="/projects?new=1"
            className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent-text hover:underline"
          >
            Create a project <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <div className="relative">
              <Search
                className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
                aria-hidden
              />
              <input
                type="search"
                aria-label="Search missions"
                placeholder="Find a mission, objective, or issue…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setExpanded(false);
                }}
                className="ui-search-input"
              />
            </div>
            <div
              role="group"
              aria-label="Filter missions"
              className="ui-filter-chip-row ui-scroll-fade-right"
            >
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={filter === item.id}
                  onClick={() => changeFilter(item.id)}
                  className={`min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors ${
                    filter === item.id
                      ? "border-accent-primary bg-surface-overlay text-text-primary"
                      : "border-border-subtle text-text-secondary hover:bg-surface-overlay"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-tertiary" aria-live="polite">
              Showing {visible.length} of {displayed.length} matching missions — site issues first,
              then active work and recent dispatches.
            </p>
          </div>

          {displayed.length === 0 ? (
            <div className="rounded-xl border border-border-subtle px-4 py-8 text-center">
              <p className="text-sm font-medium text-text-primary">No missions match</p>
              <p className="mt-1 text-sm text-text-secondary">
                Try another search or clear the filter.
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  changeFilter("all");
                }}
                className="mt-3 inline-flex min-h-11 items-center text-sm text-accent-text hover:underline"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <>
              <section aria-label="Matching missions" className="grid gap-4 md:grid-cols-2">
                {visible.map((mission) => (
                  <MissionCard key={mission.projectId} mission={mission} />
                ))}
              </section>
              {!expanded && displayed.length > initialCount && (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border-subtle px-4 text-sm font-medium text-text-primary hover:bg-surface-overlay"
                >
                  <ChevronDown className="h-4 w-4" aria-hidden /> Show all {displayed.length}{" "}
                  missions
                </button>
              )}
            </>
          )}
        </>
      )}

      <p className="flex items-start gap-2 text-xs text-text-tertiary">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Viewing a mission does not launch agents, contact people, spend money or publish items.
        Existing approvals continue to apply.
      </p>
    </div>
  );
}
