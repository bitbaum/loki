import { getUserPreferences } from "@/db/queries/user-preferences";
import { getRuntimeSnapshot, getRuntimeSnapshots } from "@/db/queries/runtime-snapshots";
import { listRecentRuns } from "@/db/queries/orchestration-runs";
import { pickDispatchChannel } from "@/lib/execution-access";
import { DEFAULT_ADAPTER_ID } from "@/lib/orchestration";
import {
  PROVIDER_SPENT_WINDOW_MS,
  currentProviderFor,
  nextProvider,
  parseProviderOrder,
  rankProviders,
  spentProviders,
  type ProviderOption,
} from "@/lib/provider-switch";

/**
 * "Who could do this work right now", assembled from what Loki has observed —
 * the evidence behind the provider chooser, gathered in ONE place.
 *
 * It used to live inline in GET /api/providers, which answers the question for
 * a run that has already failed. Implement needs the same answer BEFORE it
 * dispatches (routeAroundSpent), and a second assembly would be a second
 * ranking — the thing that route's own doc says must never exist.
 */

/** The project fields the evidence depends on. */
export type ProviderChoiceProject = {
  name: string;
  agentPref: string | null;
  dirPath: string | null;
  gitUrl: string | null;
  builderPref: string | null;
};

export type ProviderChoice = {
  /** The agent this project runs on now — excluded from `options`. */
  current: string | null;
  options: ProviderOption[];
  next: ProviderOption | null;
  /** id → why it is spent (a capacity refusal inside the window). */
  spent: Record<string, string>;
  /** False when no builder has reported a capability list — unknown, not empty. */
  installedKnown: boolean;
  /** WHICH builder the `installed` evidence came from, and WHEN it was observed. */
  evidence: { channel: string | null; observedAt: string | null };
};

export async function providerChoiceFor(
  userId: string,
  project: ProviderChoiceProject | null,
  opts: {
    /** Exclude this agent instead of the derived current one — a dispatch asks
     *  "who else, if not the agent I was about to start". */
    current?: string;
  } = {},
): Promise<ProviderChoice> {
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
  const current =
    opts.current ??
    (project
      ? currentProviderFor({
          agentPref: project.agentPref,
          projectRuns,
          defaultAdapter: DEFAULT_ADAPTER_ID,
        })
      : null);
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

  return {
    current,
    options,
    next: nextProvider(options),
    spent,
    installedKnown: installed !== null,
    evidence: { channel, observedAt: observedAt ? observedAt.toISOString() : null },
  };
}
