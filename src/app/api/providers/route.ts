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
import { getUserPreferences } from "@/db/queries/user-preferences";
import { getRuntimeSnapshot } from "@/db/queries/runtime-snapshots";
import { listRecentRuns } from "@/db/queries/orchestration-runs";
import { DEFAULT_ADAPTER_ID } from "@/lib/orchestration";
import {
  PROVIDER_SPENT_WINDOW_MS,
  currentProviderFor,
  nextProvider,
  parseProviderOrder,
  rankProviders,
  spentProviders,
} from "@/lib/provider-switch";

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

  const [prefs, snapshot, runs] = await Promise.all([
    getUserPreferences(userId).catch(() => null),
    getRuntimeSnapshot(userId).catch(() => null),
    // Enough runs to see one capacity wall per agent inside the window; the
    // query is capped at 50 and the window does the rest of the filtering.
    listRecentRuns(userId, { limit: 50, sinceMs: PROVIDER_SPENT_WINDOW_MS }).catch(() => []),
  ]);

  // What this project would run on right now — see currentProviderFor. A
  // project with no stored preference still dispatches (on the default
  // adapter), and treating that as "no current agent" is how the chooser ended
  // up offering Claude Code as the escape from a Claude Code rate limit.
  const projectRuns = project
    ? runs.filter((r) => r.projectKey.toLowerCase() === project.name.toLowerCase())
    : [];
  const current = project
    ? currentProviderFor({
        agentPref: project.agentPref,
        projectRuns,
        defaultAdapter: DEFAULT_ADAPTER_ID,
      })
    : null;
  const spent = spentProviders(runs);
  const options = rankProviders({
    current,
    order: parseProviderOrder(prefs?.agentOrder ?? null),
    installed: snapshot?.installedAgents ?? null,
    spent,
  });

  return jsonOk({
    current,
    options,
    next: nextProvider(options),
    /** False when no builder has reported a capability list — unknown, not empty. */
    installedKnown: (snapshot?.installedAgents ?? []).length > 0,
  });
}
