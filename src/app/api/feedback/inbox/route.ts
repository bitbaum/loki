import { jsonOk, jsonError } from "@/lib/api/route-helpers";
import { getSessionUserId } from "@/lib/session";
import { getFeedbackLoopMetrics, listUserFeedback } from "@/db/queries/site-feedback";
import { attachFeedbackWork } from "@/lib/feedback/attach-work";
import { verifyDeployedFixes } from "@/lib/feedback/verify-live";
import { lastNightNote } from "@/lib/autopilot-night-note";
import { getProjects } from "@/db/queries/projects";
import { projectTitle } from "@/lib/project-display";

/**
 * The cross-project feedback inbox behind /feedback: every project's rows in
 * one payload, each with its project name and honest work phase, plus the
 * fleet-wide loop metrics. Per-project actions keep their existing id-scoped
 * routes — this is a read lens, not a second write path.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const [raw, metrics, night, projects] = await Promise.all([
    listUserFeedback(userId),
    getFeedbackLoopMetrics(userId).catch(() => null),
    lastNightNote(userId),
    getProjects(userId).catch(() => []),
  ]);
  // What a person calls each project (projectTitle), so no row is labelled
  // with a folder key. A project shared with the viewer falls back to the
  // same rule applied to its name.
  const titles = new Map(projects.map((p) => [p.id, projectTitle(p)]));
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
  const feedback = raw.map((item) => ({
    ...(workById.get(item.id) ?? item),
    projectTitle: titles.get(item.projectId) ?? projectTitle({ name: item.projectName }),
  }));
  return jsonOk({ feedback, metrics, night });
}
