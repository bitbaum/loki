/**
 * GET /api/providers?project=<userProjectId>
 *
 * The one answer to "who else could do this work right now" — ordered by the
 * operator's preference, filtered to providers that can actually answer, and
 * shared by every surface that shows a blocked run: the Feedback row, the
 * Control inbox, and the Terminal rail. One chooser, one ranking; three
 * surfaces that disagree about which provider to try next is the bug this
 * route exists to make impossible.
 *
 * Deliberately NOT part of /api/control or /api/terminal/context. Both are
 * per-surface assemblies on polling cadences, and a row that is Needs-you needs
 * this list once, when the operator looks at it.
 */
import { jsonOk, jsonError, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { getUserProject, getUserProjectByEntityId } from "@/db/queries/user-projects";
import { providerChoiceFor } from "@/lib/provider-choice";

export const runtime = "nodejs";

const Query = z.object({ project: z.string().uuid().optional() });

/**
 * Callers hold different ids for the same project. The Feedback row knows the
 * ENTITY id (feedback is filed against entities); Control and Terminal hold the
 * user_projects id. Rather than make every caller look the other one up — or
 * make the chooser silently answer for "no project", which is how the spent
 * agent ends up offered as an alternative to itself — resolve either here.
 */
async function resolveProject(userId: string, id: string | undefined) {
  if (!id) return null;
  return (await getUserProject(id, userId)) ?? (await getUserProjectByEntityId(userId, id));
}

export async function GET(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);

  const parsed = Query.safeParse({
    project: new URL(req.url).searchParams.get("project") ?? undefined,
  });
  if (!parsed.success) return jsonError("Invalid project id", 400);

  const project = await resolveProject(userId, parsed.data.project);

  // The evidence and the ranking are assembled in providerChoiceFor, which
  // Implement also asks before it dispatches — one ranking, not two.
  const { current, options, next, installedKnown, evidence } = await providerChoiceFor(
    userId,
    project ?? null,
  );
  return jsonOk({
    current,
    options,
    next,
    /** False when no builder has reported a capability list — unknown, not empty. */
    installedKnown,
    /** WHICH builder the `installed` evidence came from, and WHEN it was
     *  observed. A capability claim with no machine and no timestamp reads as
     *  "true now, everywhere"; it is neither. Null channel = the union across
     *  this user's builders, because no project was named. */
    evidence,
  });
}
