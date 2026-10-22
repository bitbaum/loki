"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Compass } from "lucide-react";
import { ChoiceMenu } from "@/components/ui/choice-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { List, ListRow, ListSearch } from "@/components/ui/list-row";
import { projectTitle } from "@/lib/project-display";
import {
  filterMissionBoard,
  type MissionBoardFilter,
  type MissionBoardItem,
} from "@/lib/missions/mission-board";

const FILTERS: readonly { value: MissionBoardFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "moving", label: "In progress" },
  { value: "unplanned", label: "Needs a plan" },
  { value: "complete", label: "Reported done" },
];

const INITIAL_ROWS = 12;

/** The one grey line under a mission: the problem if there is one, else how far
 *  its goals have got — said as the project's owner reported it. */
function missionLine(m: MissionBoardItem): string {
  if (m.alert) return m.alert.label;
  if (m.goalsTotal > 0) return `${m.goalsReportedDone} of ${m.goalsTotal} goals reported done`;
  return m.statement ? "No goals yet" : "No objective yet";
}

/**
 * Missions as a list of rows (design reset, 2026-10): one per project, the
 * problem first, then work in progress. It was a grid of bordered cards under
 * four stat boxes, a chip row and three explanatory sentences. Progress stays
 * "reported" — a percentage here is what the goals say, not a verified result.
 */
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

  if (missions.length === 0) {
    return (
      <EmptyState
        icon={Compass}
        title="Your first mission starts with a project"
        action={
          <Link href="/projects?new=1" className="ui-btn-secondary">
            Create a project
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-2">
      <ListSearch
        value={query}
        onChange={(v) => {
          setQuery(v);
          setExpanded(false);
        }}
        placeholder="Search missions"
      />
      <div className="flex items-center justify-between gap-3 px-1 text-sm text-text-secondary">
        <span aria-live="polite">
          {displayed.length} {displayed.length === 1 ? "mission" : "missions"}
        </span>
        <ChoiceMenu
          label="Show"
          value={filter}
          options={FILTERS}
          onChange={(next) => {
            setFilter(next);
            setExpanded(false);
          }}
        />
      </div>

      {displayed.length === 0 ? (
        <EmptyState
          title="No missions match"
          action={
            <button
              type="button"
              className="ui-btn-secondary"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Clear the search
            </button>
          }
        />
      ) : (
        <List aria-label="Missions">
          {visible.map((mission) => (
            <ListRow
              key={mission.projectId}
              href={`/missions/${mission.projectId}`}
              avatar={projectTitle({ name: mission.name }).charAt(0).toUpperCase()}
              title={projectTitle({ name: mission.name })}
              secondary={missionLine(mission)}
              status={mission.alert ? "warning" : undefined}
              trailing={
                mission.reportedProgress !== null ? `${mission.reportedProgress}%` : undefined
              }
              chevron
            />
          ))}
          {!expanded && displayed.length > initialCount && (
            <ListRow
              title={`Show all ${displayed.length}`}
              onClick={() => setExpanded(true)}
              chevron
            />
          )}
        </List>
      )}
    </div>
  );
}
