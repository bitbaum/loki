/**
 * The Missions board is a view over existing projects, not a task database.
 * Reuse Projects' exact live-flag predicate. Never resurrect expired flags
 * or turn a self-reported goal percentage into verified completion.
 */
import { PROJECT_ATTR } from "@/config/project-attrs";
import type { ProjectGridRow } from "@/components/projects/project-grid-row";
import { hasProjectAttention, isSiteDown } from "@/lib/projects-page-stats";
import { signalIsLive } from "@/lib/project-signals";
import type { MissionProjection } from "@/lib/missions/project-mission";

export type MissionAlert = { label: string; detail: string };
export type MissionBoardItem = MissionProjection & {
  alert: MissionAlert | null;
  lastDispatchAt: string | null;
};

export type MissionBoardFilter = "all" | "attention" | "moving" | "unplanned" | "complete";

const FLAG_LABELS = [
  { key: PROJECT_ATTR.SECURITY_VULNERABILITY, label: "Security issue reported" },
  { key: PROJECT_ATTR.BROKEN_FEATURES, label: "Broken feature reported" },
  { key: PROJECT_ATTR.DEPLOYMENT_ISSUE, label: "Deployment issue reported" },
] as const;

/** Same source-of-truth flag rule as Projects/Today; no ghost alerts. */
export function missionAlertFromProject(
  project: Pick<ProjectGridRow, "attrs" | "attrMeta" | "liveUrl" | "siteOk">,
): MissionAlert | null {
  if (!hasProjectAttention(project)) return null;
  for (const { key, label } of FLAG_LABELS) {
    const detail = project.attrs[key];
    if (signalIsLive(project.attrMeta, key, detail)) {
      return { label, detail: detail.trim() };
    }
  }
  if (isSiteDown(project)) {
    return { label: "Site check failed", detail: "The latest site probe reported a failure." };
  }
  return null;
}

function lastDispatchMs(item: MissionBoardItem): number {
  const time = item.lastDispatchAt ? Date.parse(item.lastDispatchAt) : 0;
  return Number.isFinite(time) ? time : 0;
}

function priority(item: MissionBoardItem): number {
  if (item.alert) return 0;
  if (item.phase === "in-progress") return 1;
  if (item.phase === "ready") return 2;
  if (item.phase === "needs-objective") return 3;
  return 4; // Self-reported complete is never a verified achievement.
}

export function filterMissionBoard(
  missions: readonly MissionBoardItem[],
  query: string,
  filter: MissionBoardFilter,
): MissionBoardItem[] {
  const needle = query.trim().toLocaleLowerCase();
  return missions
    .filter((mission) => {
      if (filter === "attention" && !mission.alert) return false;
      if (filter === "moving" && mission.phase !== "in-progress") return false;
      if (
        filter === "unplanned" &&
        mission.phase !== "needs-objective" &&
        mission.goalsTotal > 0
      ) return false;
      if (filter === "complete" && mission.phase !== "reported-complete") return false;
      if (!needle) return true;
      const searchText = [
        mission.name,
        mission.statement,
        mission.nextObjective,
        mission.alert?.label,
        mission.alert?.detail,
        ...mission.objectives.map((objective) => objective.title),
      ]
        .filter((v): v is string => Boolean(v))
        .join(" ")
        .toLocaleLowerCase();
      return searchText.includes(needle);
    })
    .sort(
      (a, b) =>
        priority(a) - priority(b) ||
        lastDispatchMs(b) - lastDispatchMs(a) ||
        a.name.localeCompare(b.name),
    );
}
