import { NextResponse } from "next/server";
import { listOwnedTabs } from "@/lib/agent-execution/owned";
import { getProjects, type ProjectRow } from "@/db/queries/projects";
import { getLatestEventsByProjectKeys } from "@/db/queries/orchestration-events";
import {
  getLatestRunsByProjectPaths,
  getRecentOutcomesByProjectKeys,
} from "@/db/queries/orchestration-runs";
import {
  getRecentActivity,
  getRecentCustomPromptsByProjectKeys,
  type RecentCustomPrompt,
} from "@/db/queries/prompt-history";
import { getProjectActivityBatch, type ProjectActivityEvent } from "@/db/queries/activity";
import {
  getProjectStatesByUserId,
  getProjectStatesByUserIds,
  persistProjectSessionIfNewer,
} from "@/db/queries/project-states";
import type { ProjectState as DbProjectState } from "@/db/schema/project-states";
import {
  ensureUserProjectEntityLinks,
  getOrgProjects,
  recordSessionHandoffChangelog,
} from "@/db/queries/user-projects";
import { readAgentPreferences, resolveAgentConfig } from "@/lib/agent-preferences";
import { getUserPreferences } from "@/db/queries/user-preferences";
import { parseProviderOrder } from "@/lib/provider-switch";
import {
  buildSwitchableAgentCatalog,
  type AgentAvailabilityOverride,
  type AgentCatalog,
} from "@/lib/agent-catalog";
import {
  resolveEffectiveTab,
  normalizeTabName,
  readPromptMeta,
  type PromptMeta,
} from "@/lib/agent-config";
import { parseSession, readCurrentPrompt, getAgentProcesses } from "@/lib/control-fast-state";
import { DEFAULT_ADAPTER_ID, ORCHESTRATION_ADAPTER_IDS, type AdapterId } from "@/lib/orchestration";
import {
  deriveProjectLifecycle,
  persistRuntimeLifecycleEvents,
} from "@/lib/orchestration/derive-project-lifecycle";
import { adapterFor } from "@/lib/orchestration/adapter-registry";

import { gateAndCloseRun, closingRuns } from "@/lib/orchestration/gate-and-close";

// Canonical states/events (ORCHESTRATION_STATES, OrchestrationState, etc.) from
// contract (see debt roadmap Priority 1 + openclaw plan). Raw fast-state (/tmp,
// sessions) and pending-commands are *inputs* / compat only. Derived truth +
// events table should be preferred for new code. This route is being thinned to
// delegate more to lib/orchestration (deriveLifecycleState etc already used).
import { getSessionUserId } from "@/lib/session";
import { isRuntimeAvailable } from "@/lib/runtime";
import { getBuilderPresence } from "@/db/queries/runner-presence";
import { isHeartbeatFresh } from "@/lib/builder-presence";
import { isAgentId, listAgentRegistry } from "@/lib/agent-registry";
import { inferAdapterFromTabName } from "@/components/control/control-presenter";
import type {
  ProjectProfile,
  CurrentPrompt,
  ProjectState,
  SessionState,
  GitState,
  ControlData,
  FailedCommand,
  LiveAgentTurns,
} from "@/lib/control-types";
import {
  getRecentFailedCommands,
  hasUndeliveredCommandForRun,
} from "@/db/queries/pending-commands";
import { getOpenAgentTurnsByProject } from "@/db/queries/agent-sessions";
import { getRuntimeSnapshots } from "@/db/queries/runtime-snapshots";
import { writePromptQueueMirror } from "@/lib/prompt-queue-mirror";
import { fetchAllGitStates } from "@/lib/git-state";
import {
  matchProfile,
  matchProfileById,
  resolveAutoInjectOverride,
} from "@/lib/project-profile-match";
import { resolveProjectSession, isRuntimeObservationFresh } from "@/lib/project-session";
import { workspaceIdFor } from "@/lib/agent-execution/ownership";
import { normalizeRepoWorkEvidence } from "@/lib/repo-evidence";
import { isVerifiedRunActive } from "@/lib/control-run-truth";

export type {
  ProjectProfile,
  CurrentPrompt,
  ProjectState,
  SessionState,
  GitState,
  ControlData,
  FailedCommand,
};
export type { PromptMeta };
export type { ProjectActivityEvent as ActivityTimelineEvent } from "@/db/queries/activity";

// ── Slow-data cache (git + DB) ────────────────────────────────────────────────
// git state and DB profiles change infrequently; PIDs/session/tmp files are always read fresh.
// Stale-while-revalidate: return cached data immediately, refresh asynchronously when stale.

type SlowCache = {
  key: string;
  gitMap: Map<string, GitState>;
  liveTabs: string[];
  dirs: string[]; // dirs list used to build this cache
  builtAt: number;
  runtimeSnapshotUpdatedAt: Date | null;
  installedAgents: string[];
  runnerVersion: string | null;
  /** Per-channel builder versions. Two builders can be online at once — one
   *  version string cannot describe both, and last-writer-wins between the
   *  channel rows made the hero flip between "box-0.8.9" and "dev". */
  builderVersions: { cloud: string | null; local: string | null };
};

let slowCache: SlowCache | null = null;
let cacheRefreshing = false;
const CACHE_TTL_MS = 20_000; // 20s — stale after one 10s poll misses, triggers refresh

async function buildSlowData(
  userId: string,
  dirs: string[],
  names: string[],
  key: string,
): Promise<SlowCache> {
  const [gitMap, liveTabsLocal, dbStates, runtimeSnapshots] = await Promise.all([
    fetchAllGitStates(dirs),
    Promise.resolve(isRuntimeAvailable() ? listOwnedTabs(userId, names) : ([] as string[])),
    isRuntimeAvailable()
      ? Promise.resolve([] as DbProjectState[])
      : getProjectStatesByUserId(userId).catch((e): DbProjectState[] => {
          console.error("[control/slowData] projectStates failed:", e);
          return [];
        }),
    isRuntimeAvailable()
      ? Promise.resolve([])
      : getRuntimeSnapshots(userId).catch((e) => {
          console.error("[control/slowData] runtimeSnapshots failed:", e);
          return [];
        }),
  ]);
  // Cloud + local builders each push their OWN channel row. The tab list must
  // be the UNION of fresh channels — reading only the last-written row made
  // the laptop's open tabs vanish every time the cloud box pushed (and vice
  // versa), so "prime-tower" flapped between "Tab open" and "Not running" on
  // a ~5min cycle. Stale channels are excluded: a machine that stopped
  // pushing must not keep its tabs "open" forever.
  const nowMs = Date.now();
  const freshSnapshots = runtimeSnapshots.filter((s) => isHeartbeatFresh(s.observedAt, nowMs));
  // Freshness-gated for the same reason the tabs are: a channel that stopped
  // pushing must stop making claims. An unfiltered find() would keep printing
  // "app dev build" for a laptop that has been shut for a week.
  const localSnapshot = freshSnapshots.find((s) => s.channel === "local") ?? null;
  const cloudSnapshot = freshSnapshots.find((s) => s.channel === "cloud") ?? null;
  const unionTabs = [...new Set(freshSnapshots.flatMap((s) => s.openTabs ?? []))];
  // Locally: the owned PTYs. On cloud: union of fresh runner-pushed tab
  // lists, falling back to per-project tabOpen flags from project_states —
  // gated on observation freshness so a dead runner's frozen rows can't
  // resurrect tabs it stopped reporting.
  const liveTabs = isRuntimeAvailable()
    ? liveTabsLocal
    : unionTabs.length
      ? unionTabs
      : dbStates.filter((s) => s.tabOpen && isRuntimeObservationFresh(s)).map((s) => s.tabName);
  const latestObservedAt = runtimeSnapshots.reduce<Date | null>(
    (max, s) => (s.observedAt && (!max || s.observedAt > max) ? s.observedAt : max),
    null,
  );
  return {
    key,
    gitMap,
    liveTabs,
    dirs,
    builtAt: Date.now(),
    runtimeSnapshotUpdatedAt: latestObservedAt,
    // CLI availability describes the OPERATOR'S machine — the local channel is
    // authoritative when present; the cloud box's list is the fallback.
    installedAgents: localSnapshot?.installedAgents ?? cloudSnapshot?.installedAgents ?? [],
    runnerVersion: cloudSnapshot?.runnerVersion ?? localSnapshot?.runnerVersion ?? null,
    builderVersions: {
      cloud: cloudSnapshot?.runnerVersion ?? null,
      local: localSnapshot?.runnerVersion ?? null,
    },
  };
}

async function getSlowData(userId: string, dirs: string[], names: string[]): Promise<SlowCache> {
  const now = Date.now();
  const dirsKey = [...dirs].sort().join(",");
  const key = `${userId}\0${dirsKey}`;

  // Cache hit — return immediately, maybe kick off background refresh
  if (slowCache?.key === key) {
    if (now - slowCache.builtAt < CACHE_TTL_MS) return slowCache;
    // Stale: return stale immediately, refresh in background
    if (!cacheRefreshing) {
      cacheRefreshing = true;
      buildSlowData(userId, dirs, names, key)
        .then((fresh) => {
          slowCache = fresh;
          cacheRefreshing = false;
        })
        .catch((e) => {
          console.error("[control/cache] background refresh failed:", e);
          cacheRefreshing = false;
        });
    }
    return slowCache;
  }

  // Cold cache or a different user/project set: never serve mismatched data.
  slowCache = await buildSlowData(userId, dirs, names, key);
  return slowCache;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const preferences = readAgentPreferences();
  const agentConfig = resolveAgentConfig(preferences);
  const prompts = readPromptMeta();
  // The operator's provider ranking, so Control's capacity banner offers the
  // same next provider the Feedback row and Terminal rail do. Without it the
  // two surfaces named different agents for the same stalled project.
  const agentOrder = parseProviderOrder(
    (await getUserPreferences(userId).catch(() => null))?.agentOrder ?? null,
  );

  // Own projects + team projects (org peers). Own take precedence on tab-name collision.
  const [dbUserProjects, dbTeamProjects] = await Promise.all([
    ensureUserProjectEntityLinks(userId).catch((e) => {
      console.error("[control/GET] ensureUserProjectEntityLinks failed:", e);
      return [];
    }),
    getOrgProjects(userId).catch((e) => {
      console.error("[control/GET] getOrgProjects failed:", e);
      return [];
    }),
  ]);

  const seenTabs = new Set<string>();
  const toEntry = (p: (typeof dbUserProjects)[number]) => ({
    id: p.id,
    projectId: p.entityProjectId ?? null,
    tab: p.name,
    dir: p.dirPath!,
    agentPref: p.agentPref ?? null,
    modelPref: p.modelPref ?? null,
    builderPref: p.builderPref ?? null,
    ownerUserId: p.userId,
    readonly: false as boolean,
  });
  const ownEntries = dbUserProjects
    .filter((p) => p.dirPath)
    .map(toEntry)
    .filter((p) => {
      if (seenTabs.has(p.tab.toLowerCase())) return false;
      seenTabs.add(p.tab.toLowerCase());
      return true;
    });
  const teamEntries = dbTeamProjects
    .filter((p) => p.dirPath)
    .map((p) => ({ ...toEntry(p), readonly: true }))
    .filter((p) => {
      if (seenTabs.has(p.tab.toLowerCase())) return false;
      seenTabs.add(p.tab.toLowerCase());
      return true;
    });
  const projects = [...ownEntries, ...teamEntries];
  const dirs = projects.map((p) => p.dir);

  // Slow data (git + DB) served from cache — no fork needed for CWD check
  const {
    gitMap,
    liveTabs,
    runtimeSnapshotUpdatedAt,
    installedAgents,
    runnerVersion,
    builderVersions,
  } = await getSlowData(
    userId,
    dirs,
    projects.map((p) => p.tab),
  );
  const runtimeAvailable = isRuntimeAvailable();
  // Pull the canonical agent ID list straight from the registry — same source
  // buildSwitchableAgentCatalog reads from one line below. Pre-fix this was
  // a hand-typed array, which silently drifted every time we added an agent
  // to lib/agent-registry until someone happened to grep for it.
  const agentIds = listAgentRegistry().map((entry) => entry.id);
  const runnerAvailability: AgentAvailabilityOverride | undefined = runtimeAvailable
    ? undefined
    : installedAgents.length === 0
      ? (Object.fromEntries(agentIds.map((agent) => [agent, true])) as AgentAvailabilityOverride)
      : (Object.fromEntries(
          agentIds.map((agent) => [agent, installedAgents.includes(agent)]),
        ) as AgentAvailabilityOverride);
  const agentRegistry: AgentCatalog = buildSwitchableAgentCatalog(
    preferences.models,
    agentConfig.agent,
    runnerAvailability,
  );
  // Detect any known agent running in a project dir — not just the configured default
  const agentProcesses = getAgentProcesses(agentRegistry.agents);
  const projectKeys = projects.map((p) => p.tab);

  // Fetch DB states for own user + all team project owners so session progress is visible.
  const teamOwnerIds = [...new Set(dbTeamProjects.map((p) => p.userId))];
  const allOwnerIds = [userId, ...teamOwnerIds];
  const [
    latestRuns,
    recentPromptsMap,
    recentOutcomesMap,
    activityByProject,
    recentActivity,
    dbStatesArr,
    latestLifecycleEvents,
    effectiveDbProjects,
    failedCommands,
    openAgentTurns,
  ] = await Promise.all([
    getLatestRunsByProjectPaths(userId, dirs),
    getRecentCustomPromptsByProjectKeys(userId, projectKeys).catch((e) => {
      console.error("[control/GET] recentPromptsMap failed:", e);
      return new Map<string, RecentCustomPrompt[]>();
    }),
    getRecentOutcomesByProjectKeys(userId, projectKeys, 5).catch((e) => {
      console.error("[control/GET] recentOutcomesMap failed:", e);
      return new Map<string, import("@/db/schema/orchestration-runs").OrchestrationOutcome[]>();
    }),
    getProjectActivityBatch(userId, projectKeys, { days: 1, perKey: 8 }).catch((e) => {
      console.error("[control/GET] projectActivity failed:", e);
      return new Map<string, ProjectActivityEvent[]>();
    }),
    getRecentActivity(userId).catch((e) => {
      console.error("[control/GET] recentActivity failed:", e);
      return [];
    }),
    // Single batch query instead of N per-owner queries
    getProjectStatesByUserIds(allOwnerIds).catch((e): DbProjectState[] => {
      console.error("[control/GET] projectStates failed:", e);
      return [];
    }),
    getLatestEventsByProjectKeys(userId, projectKeys, [
      "input_requested",
      "close_requested",
      "session_closed",
      "task_started",
    ]).catch((e) => {
      console.error("[control/GET] lifecycleEvents failed:", e);
      return new Map();
    }),
    // Fetch own + team owners' entity projects per-request (not cached) so each user
    // always sees their own profile data regardless of who last built the git cache.
    Promise.all(
      allOwnerIds.map((oid) =>
        getProjects(oid).catch((e) => {
          console.error("[control/GET] getProjects failed for", oid, e);
          return [] as ProjectRow[];
        }),
      ),
    ).then((arrs) => arrs.flat()),
    getRecentFailedCommands([userId]).catch((e): FailedCommand[] => {
      console.error("[control/GET] failedCommands failed:", e);
      return [];
    }),
    // Agent turns the agents themselves reported open (hook-driven). Scoped to
    // `userId`, not allOwnerIds: the hooks run on THIS user's machine, so a
    // teammate's live sessions are not ours to claim on their card.
    getOpenAgentTurnsByProject(userId).catch((e): Record<string, LiveAgentTurns> => {
      console.error("[control/GET] openAgentTurns failed:", e);
      return {};
    }),
  ]);
  // Stale-run reaping moved EXCLUSIVELY to the reap-stale-runs cron (hourly),
  // which runs the close-from-handoff sweep FIRST. Reaping on page load raced
  // that ordering: a human opening /control could stamp `timeout` onto a run
  // whose ready handoff was minutes from arriving (2026-07-15: the witnessed
  // BiasLens bootstrap was reaped at +60m while its handoff sat behind a
  // permission prompt; the work had succeeded). One reaper, one ordering.
  // Key by (ownerUserId, projectKey) — two users in the same org may both have a
  // project with the same key, and we want each card to read its own owner's row.
  // normalizeTabName, not .toLowerCase(): the runner keys its pushes by the
  // live tab name ("prime-tower"), the registry by the display name ("Prime
  // tower") — a case-only join left such projects permanently detached from
  // their runtime rows (agentRunning stuck false forever).
  const dbStateMap = new Map(
    dbStatesArr.map((s) => [`${s.userId}:${normalizeTabName(s.projectKey)}`, s]),
  );

  const states: ProjectState[] = projects.map(
    ({ id, projectId, tab, dir, agentPref, modelPref, builderPref, ownerUserId, readonly }) => {
      const latestRun = latestRuns.get(dir);
      const dbState = dbStateMap.get(`${ownerUserId}:${normalizeTabName(tab)}`);

      // Resolve the live tab name first — session files and /tmp sentinels all use the live name.
      // e.g. canonical "Loki" may run as "Loki Claude", so sessions/Loki Claude.md wins.
      const liveTab = resolveEffectiveTab(tab, liveTabs);
      const projectProcesses = agentProcesses.filter(
        (process) => process.cwd === dir || process.cwd.startsWith(dir + "/"),
      );
      const promptHint = runtimeAvailable ? readCurrentPrompt(liveTab) : null;
      const liveAdapter =
        projectProcesses[0]?.agentId ??
        (promptHint?.adapter && isAgentId(promptHint.adapter) ? promptHint.adapter : null) ??
        inferAdapterFromTabName(liveTab) ??
        (agentPref && isAgentId(agentPref) ? agentPref : null) ??
        agentConfig.agent;
      const localSession = runtimeAvailable ? parseSession(liveTab, liveAdapter) : null;
      // File handoff wins, else the persisted project_states row. Shared with the
      // SSE stream via resolveProjectSession so the two paths can't diverge.
      const session = resolveProjectSession(localSession, dbState);

      // The DB is authoritative; the local runtime reads this transport mirror.
      if (!readonly && isRuntimeAvailable() && dbState?.promptQueue) {
        writePromptQueueMirror(tab, dbState.promptQueue);
      }

      // Only the project's owner writes to project_states. A viewer reading a team
      // (readonly) project's session would otherwise create a row under their own
      // userId, which would never be queried again and would drift from the owner's.
      if (
        !readonly &&
        session &&
        (!dbState || session.mtime > (dbState.sessionUpdatedAt?.getTime() ?? 0))
      ) {
        const sessionMtimeMs = session.mtime;
        persistProjectSessionIfNewer({
          projectKey: tab,
          projectId,
          userId: ownerUserId,
          workspaceId: dbState?.workspaceId ?? workspaceIdFor(ownerUserId, tab),
          tabName: liveTab,
          sessionStatus: session.status,
          sessionDone: session.done,
          sessionNext: session.next,
          sessionTests: session.tests,
          sessionTodos: session.todos,
          sessionHealth: session.health,
          sessionTsc: session.tsc,
          sessionLint: session.lint,
          sessionCommit: session.commit,
          sessionBlockReason: session.blockReason,
          sessionNoOpCount: session.noOpCount,
          sessionUpdatedAt: new Date(sessionMtimeMs),
        })
          .then((updated) => {
            // Append only for the writer that won the timestamp race. Shared with
            // the cloud ingestion path (runtime-state route) — one append point.
            if (updated && dbState) {
              recordSessionHandoffChangelog(ownerUserId, {
                projectId,
                tab,
                dateMs: sessionMtimeMs,
                previousDone: dbState.sessionDone,
                done: session.done,
                next: session.next,
                tests: session.tests,
                todos: session.todos,
                health: session.health,
              }).catch((err) => console.error("[control] devlog append failed:", err));
            }
          })
          .catch((err) => console.error("[control] session state write failed:", err));
      }

      // Resolve the orchestration seam for this project's agent. Claude binds the
      // existing lifecycle/close/enrich hooks (behavior-identical); unregistered
      // adapters yield undefined → neutral fallbacks (no close / no events).
      const adapterId: AdapterId =
        typeof liveAdapter === "string" &&
        (ORCHESTRATION_ADAPTER_IDS as readonly string[]).includes(liveAdapter)
          ? (liveAdapter as AdapterId)
          : DEFAULT_ADAPTER_ID;
      const seam = adapterFor(adapterId);

      // Close an open orchestration run when the agent's handoff reports ready.
      // The local-runtime path has no stop-hook closer since the bash-daemon kill,
      // so the session.md we just read IS the completion signal. Idempotent — only
      // the owner writes, and a run with finishedAt is never re-closed.
      if (!readonly && session && latestRun && !latestRun.finishedAt) {
        const closePatch = seam?.closeRunFromSession?.(latestRun, session) ?? null;
        // Guard: closePatch stays non-null across polls until the close persists
        // (fire-and-forget). The in-flight set keeps the DoD judge from firing
        // more than once for the same run.
        if (closePatch && !closingRuns.has(latestRun.id)) {
          closingRuns.add(latestRun.id);
          // A run whose dispatch command is still queued (gate-held behind an
          // older run) never had its prompt delivered — this handoff cannot be
          // its work; skip the close and let its own delivery + handoff close it.
          hasUndeliveredCommandForRun(ownerUserId, latestRun.id)
            .catch(() => false)
            .then((undelivered) =>
              undelivered
                ? undefined
                : gateAndCloseRun(
                    latestRun.id,
                    closePatch,
                    ownerUserId,
                    tab,
                    recentOutcomesMap.get(tab) ?? [],
                    latestRun.adapter,
                  ),
            )
            .catch((err) => console.error("[control] run close failed:", err))
            .finally(() => closingRuns.delete(latestRun.id));
        }
      }

      const nowS = Math.floor(Date.now() / 1000);

      const projectAgentId = agentPref ?? agentConfig.agent;
      const projectAgent = agentRegistry.agents.find((entry) => entry.id === projectAgentId);
      // On the cloud host (no /proc access) fall back to runner-pushed DB state so the control
      // panel reflects live agent activity on the home machine.
      // Stale runner observations must not read as live work (a killed agent
      // once showed "Working" forever) — gate the DB fallback on freshness.
      const dbRuntimeFresh = isRuntimeObservationFresh(dbState);
      const verifiedRunActive = isVerifiedRunActive(latestRun);
      const agentRunning =
        (runtimeAvailable
          ? projectProcesses.length > 0
          : dbRuntimeFresh && (dbState?.agentRunning ?? false)) || verifiedRunActive;
      const activeAgents = runtimeAvailable
        ? [
            ...new Set([
              ...projectProcesses.map((process) => process.agentId),
              ...(verifiedRunActive && latestRun?.adapter ? [latestRun.adapter] : []),
            ]),
          ]
        : dbRuntimeFresh
          ? [
              ...new Set([
                ...(dbState?.activeAgents ?? []),
                ...(verifiedRunActive && latestRun?.adapter ? [latestRun.adapter] : []),
              ]),
            ]
          : verifiedRunActive && latestRun?.adapter
            ? [latestRun.adapter]
            : [];
      const sessionLifecycleSignals =
        projectProcesses.length > 0
          ? projectProcesses.some((process) => process.sessionLifecycleSignals)
          : (projectAgent?.capabilities.sessionLifecycleSignals ?? false);

      // currentPrompt: on local machine, /tmp file is authoritative (DB fallback would
      // show stale tasks after reboot). On the cloud host, runner keeps DB current so use DB.
      const rawCurrentPrompt: CurrentPrompt | null = runtimeAvailable
        ? promptHint
        : dbState?.currentPromptKey &&
            dbState?.currentPromptLabel &&
            dbState?.currentPromptStartedAt
          ? {
              key: dbState.currentPromptKey,
              label: dbState.currentPromptLabel,
              startedAt: Math.floor(dbState.currentPromptStartedAt.getTime() / 1000),
              source: "inject" as const,
            }
          : null;
      // Agents without lifecycle callbacks can leave inject sentinels that outlive
      // the work on local runtime. Cloud runner already applies stale cleanup.
      const currentPrompt: CurrentPrompt | null = runtimeAvailable
        ? sessionLifecycleSignals || rawCurrentPrompt?.source === "runner"
          ? rawCurrentPrompt
          : null
        : rawCurrentPrompt;

      const lifecycleEvents = latestLifecycleEvents.get(tab);
      const { derived: derivedLifecycle, runtimeFacts } = deriveProjectLifecycle({
        userId: ownerUserId,
        projectKey: tab,
        liveTab,
        runtimeAvailable,
        dbState,
        lifecycleEvents,
        currentPrompt,
        nowS,
        collectAdapterEvents: seam?.collectLifecycleEvents,
      });

      if (!readonly) {
        persistRuntimeLifecycleEvents({
          userId: ownerUserId,
          projectKey: tab,
          runtimeFacts,
          lifecycleEvents,
          collectAdapterEvents: seam?.collectLifecycleEvents,
        });
      }

      return {
        id,
        projectId,
        tab,
        workspaceId: dbState?.workspaceId ?? workspaceIdFor(ownerUserId, tab),
        liveTab,
        dir,
        agentPref,
        modelPref,
        builderPref,
        session,
        git: gitMap.get(dir) ?? null,
        sessionLifecycleSignals,
        agentRunning,
        activeAgents,
        profile:
          matchProfileById(projectId, effectiveDbProjects) ??
          matchProfile(tab, dir, effectiveDbProjects),
        currentPrompt,
        readyAt: derivedLifecycle.readyAt,
        lockAt: derivedLifecycle.lockAt,
        closingAt: derivedLifecycle.closingAt,
        closedAt: derivedLifecycle.closedAt,
        recentCustomPrompts: recentPromptsMap.get(tab) ?? [],
        recentActivity: activityByProject.get(tab) ?? [],
        recentOutcomes: recentOutcomesMap.get(tab) ?? [],
        // Turns the agents reported open themselves. Keyed on the registry name,
        // which is exactly what /api/activity/capture resolves a cwd to — including
        // a worktree, which resolves to its parent project's row.
        liveAgentTurns: openAgentTurns[tab] ?? null,
        // Stream-aligned per-tab fields so the first render carries what the SSE
        // patches will keep fresh — replaces per-card polling on mount.
        promptQueue: dbState?.promptQueue ?? [],
        promptQueueRevision: dbState?.promptQueueRevision ?? 0,
        autoContinueEnabled: dbState?.autoContinueEnabled ?? true,
        autoInjectModeOverride: resolveAutoInjectOverride(projectId, tab, dir, effectiveDbProjects),
        latestOrchestrationRun: latestRun
          ? {
              adapter: latestRun.adapter,
              intent: latestRun.intent,
              state: latestRun.state,
              startedAt: latestRun.startedAt?.toISOString?.() ?? String(latestRun.startedAt),
              finishedAt: latestRun.finishedAt
                ? (latestRun.finishedAt.toISOString?.() ?? String(latestRun.finishedAt))
                : null,
              summary: latestRun.summary ?? null,
              tokensIn: latestRun.tokensIn ?? null,
              tokensOut: latestRun.tokensOut ?? null,
              tokensCacheRead: latestRun.tokensCacheRead ?? null,
              costUsd: latestRun.costUsd ?? null,
              payload: latestRun.payload
                ? {
                    resultText: latestRun.payload.resultText,
                    error: latestRun.payload.error,
                    note:
                      typeof latestRun.payload.note === "string"
                        ? latestRun.payload.note
                        : undefined,
                    // Validated, not cast: payload is jsonb, so `kind` arrives as a bare
                    // string and the card renders different words per kind. An unknown
                    // kind drops the whole evidence block rather than shipping a link
                    // labelled by a value nothing checked.
                    evidence: normalizeRepoWorkEvidence(latestRun.payload.evidence) ?? undefined,
                    durationMs: latestRun.payload.durationMs,
                    model: latestRun.payload.model,
                  }
                : null,
            }
          : null,
      };
    },
  );

  return NextResponse.json(
    {
      agentRegistry,
      agentConfig,
      agentOrder,
      orchestration: {
        manualPromptInjection: true,
        autonomousPromptLoop: true,
        sessionLifecycleSignals: true,
      },
      inventory: {
        source: "user_projects",
        trackedProjectCount: dbUserProjects.length,
        controlProjectCount: projects.length,
        linkedDirectoryCount: dbUserProjects.filter((project) => Boolean(project.dirPath)).length,
      },
      projects: states,
      prompts,
      liveTabs,
      recentActivity: recentActivity ?? [],
      runtimeAvailable: isRuntimeAvailable(),
      // "sync Xm ago" must mean A RUNNER PUSHED Xm ago — nothing else. This
      // used to max() in project_states.updatedAt, which web-originated writes
      // (queueing a prompt, toggling auto-continue) also bump, and which
      // includes TEAMMATES' rows: queueing from the browser made a dead runner
      // read "online · sync just now", and the same laundered timestamp fed
      // offline detection. Only runtime observation times count now, and only
      // the current user's rows — a teammate's runner is not your sync.
      runnerLastPushedAt: !isRuntimeAvailable()
        ? (() => {
            let maxAt: Date | null = runtimeSnapshotUpdatedAt;
            for (const s of dbStatesArr) {
              if (s.userId !== userId) continue;
              const t = s.runtimeObservedAt;
              if (t && (!maxAt || t > maxAt)) maxAt = t;
            }
            return maxAt?.toISOString() ?? null;
          })()
        : null,
      runnerVersion: !isRuntimeAvailable() ? runnerVersion : null,
      builderVersions: !isRuntimeAvailable() ? builderVersions : null,
      builderPresence: !isRuntimeAvailable()
        ? // Read at request time, NOT from the slow cache above: that cache is
          // served stale while it refreshes, so cached heartbeat timestamps age
          // out and report a live builder as offline.
          await getBuilderPresence(userId, runnerVersion).catch(() => null)
        : null,
      // Execution health (≠ push heartbeat): a runner can keep pushing snapshots
      // while its command loop is hung, so dispatches silently queue forever.
      // Surface that so a stalled runner is visible, not masquerading as "Connected".
      runnerExecutionStall: !isRuntimeAvailable()
        ? await (await import("@/db/queries/pending-commands")).getRunnerExecutionStall(userId)
        : null,
      failedCommands: failedCommands ?? [],
    } satisfies ControlData,
    {
      // Browser-side cache: private (per-user payload — never share at the
      // edge) + 5s freshness. Multi-tab users + rapid SWR refetches now
      // serve from the local HTTP cache instead of re-running this route's
      // full query chain on every navigation. Critical for keeping egress
      // bounded for safety on self-hosted Postgres.
      headers: { "Cache-Control": "private, max-age=5" },
    },
  );
}
