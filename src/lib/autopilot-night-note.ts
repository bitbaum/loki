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

export type NightNote = { night: string; note: string };

export async function lastNightNote(userId: string): Promise<NightNote | null> {
  const row = await getLatestAutopilotNight(userId).catch(() => null);
  if (!row) return null;
  const runIds = [...row.summary.fixes, ...row.summary.reads]
    .map((r) => r.runId)
    .filter((id): id is string => !!id);
  const runs = await getOrchestrationRunsByIds(userId, runIds).catch(() => new Map());
  const spent = [...runs.values()].reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const note = nightNoteText(row.summary, spent);
  return note ? { night: row.night, note } : null;
}
