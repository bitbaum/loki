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
import { getRuntimeSnapshot, getRuntimeSnapshots } from "@/db/queries/runtime-snapshots";
import { pickDispatchChannel } from "@/lib/execution-access";
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

  // WHICH MACHINE the evidence is about. `installed` is a capability report
  // from one builder, and the channel-less getRuntimeSnapshot returns whichever
  // channel pushed most recently — its own doc says so. Reading that as "the"
  // answer meant a cloud heartbeat could make the chooser call a laptop-only
  // agent "not installed", and a laptop heartbeat do the same to the box: a
  // confident claim about a different computer.
  //
  // With a project we know exactly where it would dispatch, so we ask that
  // channel. Without one there is no such thing as "the" builder, so the
  // honest input is the union: an agent installed on ANY builder is launchable
  // somewhere, and only an agent no builder reports is genuinely absent.
  const channel = project
    ? pickDispatchChannel({
        dirPath: project.dirPath,
        gitUrl: project.gitUrl,
        builderPref: project.builderPref,
      })
    : null;

  const [prefs, snapshot, allSnapshots, runs] = await Promise.all([
    getUserPreferences(userId).catch(() => null),
    channel ? getRuntimeSnapshot(userId, channel).catch(() => null) : Promise.resolve(null),
    channel ? Promise.resolve([]) : getRuntimeSnapshots(userId).catch(() => []),
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
  // null, not [] — absent is not empty. No row for this channel means no
  // builder there has ever reported, which is UNKNOWN; rendering it as "none
  // installed" would disable every alternative on the strength of silence.
  const installed = channel
    ? (snapshot?.installedAgents ?? null)
    : allSnapshots.length
      ? [...new Set(allSnapshots.flatMap((row) => row.installedAgents ?? []))]
      : null;
  const observedAt = channel
    ? (snapshot?.updatedAt ?? null)
    : allSnapshots.reduce<Date | null>(
        (latest, row) => (!latest || row.updatedAt > latest ? row.updatedAt : latest),
        null,
      );
  const options = rankProviders({
    current,
    order: parseProviderOrder(prefs?.agentOrder ?? null),
    installed,
    spent,
  });

  return jsonOk({
    current,
    options,
    next: nextProvider(options),
    /** False when no builder has reported a capability list — unknown, not empty. */
    installedKnown: installed !== null,
    /** WHICH builder the `installed` evidence came from, and WHEN it was
     *  observed. A capability claim with no machine and no timestamp reads as
     *  "true now, everywhere"; it is neither. Null channel = the union across
     *  this user's builders, because no project was named. */
    evidence: {
      channel,
      observedAt: observedAt ? observedAt.toISOString() : null,
    },
  });
}
