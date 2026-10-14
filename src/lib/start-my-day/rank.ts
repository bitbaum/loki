import { MAX_CONCURRENT_BUILDING } from "@/lib/constants/control";
import { DAY_MS } from "@/lib/constants/time";

export const RECENT_WORK_DAYS = 7;
export const DAY_PROJECT_LIMIT = 7;

export type DayProjectInput = {
  id: string;
  name: string;
  main?: boolean;
  accessReason?: string;
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
  main: boolean;
  lastActiveAt: string;
  why: string;
  unavailable: string | null;
};

export type DayPlan = {
  projects: DayProject[];
  catalog?: DayProject[];
  labels?: Record<string, string>;
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
      if (!latest && !p.main) return [];
      return [
        {
          id: p.id,
          name: p.name,
          href: p.href,
          main: Boolean(p.main),
          lastActiveAt: latest ? new Date(latest.ms).toISOString() : "",
          why: latest
            ? `${p.main ? "Main project · " : ""}Recent ${latest.source} · ${new Date(latest.ms).toISOString().slice(0, 10)}`
            : "Main project · no recent activity observed",
          unavailable:
            p.accessReason ??
            (p.paused
              ? "Paused for this project"
              : p.busy
                ? "Already working or queued"
                : !p.runnable
                  ? "Set up a project path first"
                  : null),
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(b.main) - Number(a.main) ||
        (Date.parse(b.lastActiveAt) || 0) - (Date.parse(a.lastActiveAt) || 0) ||
        a.id.localeCompare(b.id),
    );
  // Actionable projects lead; working/paused projects still explain their absence
  // from the default selection instead of silently disappearing.
  const mains = ranked.filter((p) => p.main);
  const scope = mains;
  const projects = [
    ...scope.filter((p) => !p.unavailable),
    ...scope.filter((p) => p.unavailable),
  ].slice(0, mains.length ? Math.max(DAY_PROJECT_LIMIT, mains.length) : DAY_PROJECT_LIMIT);
  return {
    projects,
    selectedIds: projects
      .filter((p) => p.main && !p.unavailable)
      .slice(0, MAX_CONCURRENT_BUILDING)
      .map((p) => p.id),
    totalRecent: ranked.filter((p) => p.lastActiveAt).length,
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
