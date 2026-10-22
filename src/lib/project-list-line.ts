import type { ProjectGridRow } from "@/components/projects/project-grid-row";
import { HEALTH_SIGNAL_BASE } from "@/components/projects/project-detail-types";
import { PROJECT_STAGE, resolveProjectStage } from "@/lib/constants/statuses";
import { signalIsLive } from "@/lib/project-signals";
import { shortTimeAgo } from "@/lib/dates";

/**
 * What one row of /projects says about a project — design reset rule 3
 * (docs/development/design-reset-2026-10.md): ONE plain-word line, and one
 * trailing fact.
 *
 * The row used to carry stage capitals, "Not connected" in orange, "8 of 10
 * checks", "last run 2m ago" and "8 feedback" — five facts and two colours on
 * every project, so 42 projects read as 42 alarms (owner, 2026-10-21: "a
 * Frankenstein element with a bunch of stuff thrown in"). The question a row
 * answers is the one a person asks of a list: is this one fine, or does it
 * want something from me? Checks, stage and counts live on the project page.
 *
 * The first answer that is true wins, in the order a person would want to be
 * told: something broken, something running, something waiting on them, then
 * how it is.
 */

/** What is running on a project right now (lib/project-build-status kinds). */
export type ProjectRunNow = "building" | "queued" | "needs_you" | "stalled";

export type ProjectListTone = "negative" | "warning" | "positive" | null;

export type ProjectListLine = {
  text: string;
  /** A dot before the line — only for a state worth acting on (rule 8). */
  tone: ProjectListTone;
};

/** Signal keys in the order a person would want to hear them. */
const SIGNAL_WORDS: Record<string, string> = {
  security: "Security problem",
  broken: "Something is broken",
  deployment: "Deploy problem",
};

export function projectListLine(
  project: Pick<ProjectGridRow, "attrs" | "attrMeta" | "liveUrl" | "siteOk">,
  {
    lastRunAt,
    newNotes = 0,
    runNow = null,
  }: {
    /** ISO of the newest agent run on this project; null = never. */
    lastRunAt?: string | null;
    /** Notes from the site nobody has looked at yet. */
    newNotes?: number;
    runNow?: ProjectRunNow | null;
  } = {},
): ProjectListLine {
  if (project.liveUrl && project.siteOk === false)
    return { text: "Site is down", tone: "negative" };

  for (const signal of HEALTH_SIGNAL_BASE) {
    if (signalIsLive(project.attrMeta, signal.key, project.attrs[signal.key]))
      return { text: SIGNAL_WORDS[signal.kind] ?? signal.label, tone: "negative" };
  }

  if (runNow === "building") return { text: "Building now", tone: "positive" };
  if (runNow === "queued") return { text: "Starting", tone: "positive" };
  if (runNow === "needs_you") return { text: "Needs you: the agent is waiting", tone: "warning" };
  if (runNow === "stalled") return { text: "Didn't start — try again", tone: "warning" };

  if (newNotes > 0)
    return {
      text: `Needs you: ${newNotes} ${newNotes === 1 ? "note" : "notes"}`,
      tone: "warning",
    };

  // How it is. WHEN it was last worked on is the row's trailing fact
  // (projectListTrailing), so the line never says it twice ("Worked on 1d
  // ago … 1d" read as a stutter on the first screenshot).
  const stage = resolveProjectStage(project.attrs.status);
  if (stage === PROJECT_STAGE.PAUSED) return { text: "Paused", tone: null };
  if (project.liveUrl) return { text: "Live", tone: null };
  if (lastRunAt && Number.isFinite(Date.parse(lastRunAt)))
    return { text: "Not live yet", tone: null };
  return { text: "Not started yet", tone: null };
}

/** The row's one trailing fact: how long since an agent last worked on it. */
export function projectListTrailing(
  lastRunAt: string | null | undefined,
  nowMs = Date.now(),
): string | null {
  const ran = lastRunAt ? Date.parse(lastRunAt) : NaN;
  if (!Number.isFinite(ran)) return null;
  return shortTimeAgoAt(ran, nowMs);
}

/**
 * A project the list folds under "Archived": one its owner marked archived,
 * or a copy minted by the retired `<host>-refresh-<32 hex>` scheme — a
 * superseded first attempt that reads, through projectTitle(), as a second
 * "Xhiva" beside the real one. Folded, never deleted: the data stays, and the
 * project still opens.
 */
export function isArchivedProject(project: Pick<ProjectGridRow, "name" | "attrs">): boolean {
  if (resolveProjectStage(project.attrs.status) === PROJECT_STAGE.ARCHIVED) return true;
  return isEarlierCopy(project.name);
}

/** A name minted by the retired `<host>-refresh-<32 hex>` scheme. */
export function isEarlierCopy(name: string): boolean {
  return /-refresh-[0-9a-f]{32}$/.test(name);
}

// shortTimeAgo reads the wall clock; this lets the caller (and a test) pass
// one.
function shortTimeAgoAt(ms: number, nowMs: number): string {
  return shortTimeAgo(ms - (nowMs - Date.now()));
}
