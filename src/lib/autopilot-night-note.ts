/**
 * The morning note: what the last autopilot night did, with its spend where
 * the runner reported one. Null when there was no night or it did nothing.
 *
 * Read by /feedback (the inbox's header) and by /today (the brief), so both
 * surfaces say the same sentence about the same night.
 */
import { getLatestAutopilotNight } from "@/db/queries/autopilot-nights";
import { getOrchestrationRunsByIds } from "@/db/queries/orchestration-runs";
import { nightNoteText } from "@/config/autopilot-night";
import { getProjects } from "@/db/queries/projects";
import { projectTitle } from "@/lib/project-display";

export type NightNote = { night: string; note: string };

export async function lastNightNote(userId: string): Promise<NightNote | null> {
  const row = await getLatestAutopilotNight(userId).catch(() => null);
  if (!row) return null;
  const runIds = [...row.summary.fixes, ...row.summary.reads]
    .map((r) => r.runId)
    .filter((id): id is string => !!id);
  const [runs, projects] = await Promise.all([
    getOrchestrationRunsByIds(userId, runIds).catch(() => new Map()),
    getProjects(userId).catch(() => []),
  ]);
  const spent = [...runs.values()].reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  // The summary keeps each project's folder key; the note names it the way
  // every list does.
  const titles = new Map(projects.map((p) => [p.name, projectTitle(p)]));
  const note = nightNoteText(
    row.summary,
    spent,
    (name) => titles.get(name) ?? projectTitle({ name }),
  );
  return note ? { night: row.night, note } : null;
}
