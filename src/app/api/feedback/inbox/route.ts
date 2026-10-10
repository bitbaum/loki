import { jsonOk, jsonError } from "@/lib/api/route-helpers";
import { getSessionUserId } from "@/lib/session";
import { getFeedbackLoopMetrics, listUserFeedback } from "@/db/queries/site-feedback";
import { attachFeedbackWork } from "@/lib/feedback/attach-work";
import { verifyDeployedFixes } from "@/lib/feedback/verify-live";
import { getLatestAutopilotNight } from "@/db/queries/autopilot-nights";
import { getOrchestrationRunsByIds } from "@/db/queries/orchestration-runs";
import { nightNoteText } from "@/config/autopilot-night";

/**
 * The morning note: what the last autopilot night did, with its spend where
 * the runner reported one. Null when there was no night or it did nothing.
 */
async function lastNightNote(userId: string): Promise<{ night: string; note: string } | null> {
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

/**
 * The cross-project feedback inbox behind /feedback: every project's rows in
 * one payload, each with its project name and honest work phase, plus the
 * fleet-wide loop metrics. Per-project actions keep their existing id-scoped
 * routes — this is a read lens, not a second write path.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const [raw, metrics, night] = await Promise.all([
    listUserFeedback(userId),
    getFeedbackLoopMetrics(userId).catch(() => null),
    lastNightNote(userId),
  ]);
  // A collaborator's row executes in the project owner's tenant. Enrich each
  // owner's runs with that owner id, then restore the original newest-first
  // order; using the viewer id would make editor-visible runs look absent.
  const byOwner = new Map<string, typeof raw>();
  for (const item of raw) byOwner.set(item.userId, [...(byOwner.get(item.userId) ?? []), item]);
  const enriched = (
    await Promise.all(
      [...byOwner].map(async ([ownerId, items]) =>
        // A live fix nobody has looked at: Loki reads the page now, so the
        // decision the row offers rests on what the page shows, not on the
        // agent's word (verify-live.ts). A few per load, on the owner's budget.
        verifyDeployedFixes(ownerId, await attachFeedbackWork(ownerId, items)),
      ),
    )
  ).flat();
  const workById = new Map(enriched.map((item) => [item.id, item]));
  const feedback = raw.map((item) => workById.get(item.id) ?? item);
  return jsonOk({ feedback, metrics, night });
}
