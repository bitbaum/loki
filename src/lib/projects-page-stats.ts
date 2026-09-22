import type { ProjectGridRow } from "@/components/projects/project-grid-row";
import { PROJECT_ATTR } from "@/config/project-attrs";
import { hasAnswer } from "@/lib/project-display";

export type ProjectsPageFilter = null | "attention" | "next-step" | "team";

export function isSiteDown(project: Pick<ProjectGridRow, "liveUrl" | "siteOk">): boolean {
  return Boolean(project.liveUrl) && project.siteOk === false;
}

export interface ProjectsPageStats {
  total: number;
  attention: number;
  withNextStep: number;
  team: number;
  own: number;
}

/** Attr keys that flag a project as needing attention on the Projects page. */
const ATTENTION_KEYS = [
  PROJECT_ATTR.SECURITY_VULNERABILITY,
  PROJECT_ATTR.BROKEN_FEATURES,
  PROJECT_ATTR.DEPLOYMENT_ISSUE,
] as const;

export function hasProjectAttention(
  project: Pick<ProjectGridRow, "attrs" | "liveUrl" | "siteOk">,
): boolean {
  return ATTENTION_KEYS.some((k) => Boolean(project.attrs[k])) || isSiteDown(project);
}

export function computeProjectsPageStats(projects: ProjectGridRow[]): ProjectsPageStats {
  let attention = 0;
  let withNextStep = 0;
  let team = 0;

  for (const p of projects) {
    if (p.readonly) team += 1;
    if (hasProjectAttention(p)) attention += 1;
    if (hasAnswer(p.attrs[PROJECT_ATTR.NEXT_STEP])) withNextStep += 1;
  }

  return {
    total: projects.length,
    attention,
    withNextStep,
    team,
    own: projects.length - team,
  };
}

export function filterProjects(
  projects: ProjectGridRow[],
  query: string,
  pageFilter: ProjectsPageFilter,
  /** entity id → ISO of the newest real dispatch; the same map the rows label
   *  themselves from. Omitted (tests, callers without it) → recency is simply
   *  not a factor and the order falls through to name. */
  lastActivityByProject?: Record<string, string>,
): ProjectGridRow[] {
  const q = query.trim().toLowerCase();

  const result = projects.filter((p) => {
    if (pageFilter === "team" && !p.readonly) return false;
    if (pageFilter === "attention" && !hasProjectAttention(p)) return false;
    if (pageFilter === "next-step" && !hasAnswer(p.attrs[PROJECT_ATTR.NEXT_STEP])) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.description ?? "").toLowerCase().includes(q) ||
      Object.values(p.attrs).some((v) => v.toLowerCase().includes(q))
    );
  });

  const now = Date.now();
  return result.sort((a, b) => {
    const aHasIssues = hasProjectAttention(a);
    const bHasIssues = hasProjectAttention(b);
    if (aHasIssues !== bHasIssues) return aHasIssues ? -1 : 1;
    // A project created moments ago is the one the operator is here for; an
    // alphabetical fold of 25 hid kaffeeklappe-sep11 right after Add
    // (2026-09-11). Newest first for a day, then the usual order.
    const aNew = isFreshProject(a, now);
    const bNew = isFreshProject(b, now);
    if (aNew !== bNew) return aNew ? -1 : 1;
    if (aNew && bNew) return createdMs(b) - createdMs(a);

    // MOST RECENTLY ACTIVE. Every row already prints "active 23d ago", and
    // until now the list ignored the very number it displayed: the real
    // tiebreaker was `name.localeCompare`, and with 22 of 36 projects holding
    // a next step, the ALPHABET decided most of the page. Measured on prod
    // 2026-09-22: 9 inversions across 21 adjacent pairs; loki, active seven
    // minutes earlier, sat ELEVENTH, below two projects untouched for a month;
    // and the three projects whose runs had failed at 06:00 that morning sat
    // at 15, 18 and 20.
    //
    // Two tiers were removed to get here, both undocumented:
    //   - has-a-next-step first. Backwards on its face — a project that knows
    //     its next step is the one that needs you LEAST — and it was the tier
    //     that split the page into two alphabetical blocks.
    //   - own-before-team. A team project touched yesterday outranks a
    //     personal one untouched for a month; recency says that better.
    //
    // What survives is one sentence a reader can hold: flagged first, then
    // most recently active. The header says exactly that, so the order is
    // legible instead of mysterious.
    const aSeen = lastActivityMs(a, lastActivityByProject);
    const bSeen = lastActivityMs(b, lastActivityByProject);
    if (aSeen !== bSeen) return bSeen - aSeen;

    // Same recency (usually: both never dispatched) — a stable, explicable
    // order beats an arbitrary one.
    return a.name.localeCompare(b.name);
  });
}

/**
 * When this project last did something, as epoch ms; 0 when it never has.
 *
 * Read from the same map the row renders its "active … ago" label from, so the
 * order and the label can never disagree — a list sorted by one clock and
 * labelled with another is how this page came to display the exact number it
 * was ignoring.
 */
function lastActivityMs(
  p: ProjectGridRow,
  lastActivityByProject: Record<string, string> | undefined,
): number {
  const iso = lastActivityByProject?.[p.id];
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

export const FRESH_PROJECT_MS = 24 * 60 * 60 * 1000;

function createdMs(p: ProjectGridRow): number {
  const v = p.createdAt;
  if (!v) return 0;
  const ms = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(ms) ? ms : 0;
}

export function isFreshProject(p: ProjectGridRow, now = Date.now()): boolean {
  const ms = createdMs(p);
  return ms > 0 && now - ms < FRESH_PROJECT_MS;
}
