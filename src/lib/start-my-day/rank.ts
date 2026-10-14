import { MAX_CONCURRENT_BUILDING } from "@/lib/constants/control";
import { DAY_MS } from "@/lib/constants/time";

export const RECENT_WORK_DAYS = 7;
export const DAY_PROJECT_LIMIT = 7;

export type DayProjectInput = {
  id: string;
  name: string;
  href: string;
  runnable: boolean;
  paused: boolean;
  busy: boolean;
  activity: { at: string; source: "commit" | "session" | "run" | "dev log" }[];
};

export type DayProject = {
  id: string;
  name: string;
  href: string;
  lastActiveAt: string;
  why: string;
  unavailable: string | null;
};

export type DayPlan = {
  projects: DayProject[];
  selectedIds: string[];
  totalRecent: number;
  githubChecked: boolean;
  maxProjects: number;
};

/** Recency is evidence of interest, not a claim to know the person's priorities.
 * Never use profile updatedAt or runner heartbeats as evidence of development. */
export function rankDayProjects(inputs: DayProjectInput[], now = Date.now()) {
  const cutoff = now - RECENT_WORK_DAYS * DAY_MS;
  const ranked = inputs
    .flatMap((p): DayProject[] => {
      const latest = p.activity
        .map((a) => ({ ...a, ms: Date.parse(a.at) }))
        .filter((a) => Number.isFinite(a.ms) && a.ms >= cutoff && a.ms <= now)
        .sort((a, b) => b.ms - a.ms)[0];
      if (!latest) return [];
      return [
        {
          id: p.id,
          name: p.name,
          href: p.href,
          lastActiveAt: new Date(latest.ms).toISOString(),
          why: `Recent ${latest.source} · ${new Date(latest.ms).toISOString().slice(0, 10)}`,
          unavailable: p.paused
            ? "Paused for this project"
            : p.busy
              ? "Already working or queued"
              : !p.runnable
                ? "Set up a project path first"
                : null,
        },
      ];
    })
    .sort(
      (a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt) || a.id.localeCompare(b.id),
    );
  // Actionable projects lead; working/paused projects still explain their absence
  // from the default selection instead of silently disappearing.
  const projects = [
    ...ranked.filter((p) => !p.unavailable),
    ...ranked.filter((p) => p.unavailable),
  ].slice(0, DAY_PROJECT_LIMIT);
  return {
    projects,
    selectedIds: projects
      .filter((p) => !p.unavailable)
      .slice(0, MAX_CONCURRENT_BUILDING)
      .map((p) => p.id),
    totalRecent: ranked.length,
    maxProjects: MAX_CONCURRENT_BUILDING,
  };
}

/** Explicit empty selection must never widen to the whole fleet. */
export function resolveDaySelection<T extends { id: string }>(
  ids: string[],
  projects: T[],
): T[] | null {
  if (ids.length === 0 || ids.length > MAX_CONCURRENT_BUILDING || new Set(ids).size !== ids.length)
    return null;
  const selected = ids.map((id) => projects.find((p) => p.id === id));
  return selected.every((p) => p !== undefined) ? selected : null;
}
