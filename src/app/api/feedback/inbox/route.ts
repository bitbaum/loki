import { jsonOk, jsonError } from "@/lib/api/route-helpers";
import { getSessionUserId } from "@/lib/session";
import { getFeedbackLoopMetrics, listUserFeedback } from "@/db/queries/site-feedback";
import { attachFeedbackWork } from "@/lib/feedback/attach-work";

/**
 * The cross-project feedback inbox behind /feedback: every project's rows in
 * one payload, each with its project name and honest work phase, plus the
 * fleet-wide loop metrics. Per-project actions keep their existing id-scoped
 * routes — this is a read lens, not a second write path.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const [raw, metrics] = await Promise.all([
    listUserFeedback(userId),
    getFeedbackLoopMetrics(userId).catch(() => null),
  ]);
  // A collaborator's row executes in the project owner's tenant. Enrich each
  // owner's runs with that owner id, then restore the original newest-first
  // order; using the viewer id would make editor-visible runs look absent.
  const byOwner = new Map<string, typeof raw>();
  for (const item of raw) byOwner.set(item.userId, [...(byOwner.get(item.userId) ?? []), item]);
  const enriched = (
    await Promise.all([...byOwner].map(([ownerId, items]) => attachFeedbackWork(ownerId, items)))
  ).flat();
  const workById = new Map(enriched.map((item) => [item.id, item]));
  const feedback = raw.map((item) => workById.get(item.id) ?? item);
  return jsonOk({ feedback, metrics });
}
