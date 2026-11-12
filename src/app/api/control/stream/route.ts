import { ensureUserProjectEntityLinks, getOrgProjects } from "@/db/queries/user-projects";
import { getProjectStatesByUserIds } from "@/db/queries/project-states";
import { getBuilderPresence } from "@/db/queries/runner-presence";
import type { ProjectState as DbProjectState } from "@/db/schema/project-states";
import { readAgentPreferences, resolveAgentConfig } from "@/lib/agent-preferences";
import { buildSwitchableAgentCatalog } from "@/lib/agent-catalog";
import { resolveEffectiveTab, normalizeTabName } from "@/lib/agent-config";
import { getAgentProcesses, readFastState } from "@/lib/control-fast-state";
import { listOwnedTabs } from "@/lib/agent-execution/owned";
import { getSessionUserId } from "@/lib/session";
import { isRuntimeAvailable } from "@/lib/runtime";
import { SSE_KEEPALIVE_MS } from "@/lib/constants/time";
import type { FastProjectState } from "@/lib/control-fast-state";
import { sseBus } from "@/lib/sse-bus";
import {
  resolveProjectSession,
  dbRowToSession,
  isRuntimeObservationFresh,
} from "@/lib/project-session";
import { subscribeControlNotify } from "@/lib/control-notify";

export const dynamic = "force-dynamic";

// Map DB state rows to the FastProjectState shape the SSE client expects.
// Used on the cloud host where /proc and /tmp are unavailable — runner keeps DB current.
function dbToFastState(
  confProjects: Array<{ tab: string; ownerUserId: string }>,
  dbRows: DbProjectState[],
): FastProjectState[] {
  // Key by (ownerUserId, projectKey) so two users with the same project name
  // don't collide when an org peer is viewing a team project. normalizeTabName
  // so "Prime tower" finds the runner's "prime-tower" row — same join fix as
  // /api/control's dbStateMap.
  const byKey = new Map(dbRows.map((r) => [`${r.userId}:${normalizeTabName(r.projectKey)}`, r]));
  return confProjects.map(({ tab, ownerUserId }) => {
    const r = byKey.get(`${ownerUserId}:${normalizeTabName(tab)}`);
    if (!r)
      return {
        tab,
        workspaceId: null,
        agentRunning: false,
        tabOpen: false,
        activeAgents: [],
        session: null,
        currentPrompt: null,
        readyAt: null,
        lockAt: null,
        closingAt: null,
        closedAt: null,
      };
    // Runtime liveness claims expire when the runner stops reporting this
    // project (see isRuntimeObservationFresh) — session handoffs do not.
    const fresh = isRuntimeObservationFresh(r);
    return {
      tab,
      workspaceId: r.workspaceId,
      agentRunning: fresh && r.agentRunning,
      tabOpen: fresh && r.tabOpen,
      activeAgents: fresh ? r.activeAgents : [],
      session: dbRowToSession(r),
      currentPrompt:
        fresh && r.currentPromptKey
          ? {
              key: r.currentPromptKey,
              label: r.currentPromptLabel ?? r.currentPromptKey,
              startedAt: r.currentPromptStartedAt
                ? Math.floor(r.currentPromptStartedAt.getTime() / 1000)
                : 0,
              source: "inject" as const,
            }
          : null,
      readyAt: r.readyAt ? Math.floor(r.readyAt.getTime() / 1000) : null,
      lockAt: r.lockAt ? Math.floor(r.lockAt.getTime() / 1000) : null,
      closingAt: r.closingAt ? Math.floor(r.closingAt.getTime() / 1000) : null,
      closedAt: r.closedAt ? Math.floor(r.closedAt.getTime() / 1000) : null,
      promptQueue: r.promptQueue ?? [],
      promptQueueRevision: r.promptQueueRevision,
      autoContinueEnabled: r.autoContinueEnabled,
    };
  });
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId)
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  const preferences = readAgentPreferences();
  const agentConfig = resolveAgentConfig(preferences);
  const agentRegistry = buildSwitchableAgentCatalog(preferences.models, agentConfig.agent);

  const [dbUserProjects, dbTeamProjects] = await Promise.all([
    ensureUserProjectEntityLinks(userId).catch(() => []),
    getOrgProjects(userId).catch(() => []),
  ]);
  const seenStreamTabs = new Set<string>();
  const confProjects = [...dbUserProjects, ...dbTeamProjects]
    .filter(
      (p) =>
        p.dirPath &&
        !seenStreamTabs.has(p.name.toLowerCase()) &&
        seenStreamTabs.add(p.name.toLowerCase()),
    )
    .map((p) => {
      const agentId = p.agentPref ?? agentConfig.agent;
      const agent = agentRegistry.agents.find((entry) => entry.id === agentId);
      return {
        tab: p.name,
        dir: p.dirPath!,
        ownerUserId: p.userId,
        sessionLifecycleSignals: agent?.capabilities.sessionLifecycleSignals ?? false,
      };
    });
  // Fetch state for own user + team owners so org-shared projects show live state too.
  const ownerIds = [...new Set([userId, ...confProjects.map((p) => p.ownerUserId)])];

  // Tabs with a live owned PTY, refreshed every 10s so a freshly started
  // session flips tabOpen without a reconnect.
  const knownTabs = confProjects.map((p) => p.tab);
  let liveTabCache = listOwnedTabs(userId, knownTabs);
  let lastTabRefreshMs = Date.now();

  const TAB_CACHE_TTL_MS = 10_000;

  const refreshTabsCacheIfStale = () => {
    if (Date.now() - lastTabRefreshMs < TAB_CACHE_TTL_MS) return;
    lastTabRefreshMs = Date.now();
    try {
      liveTabCache = listOwnedTabs(userId, knownTabs);
    } catch {
      /* executor not ready — keep the last list */
    }
  };

  let lastSent: FastProjectState[] = [];
  let lastRunnerConnected: boolean | null = null;
  let lastBuilderPresence: { cloud: boolean; local: boolean; any: boolean } | null = null;
  let keepaliveTimer: ReturnType<typeof setTimeout> | null = null;

  const scanProjects = async (): Promise<FastProjectState[]> => {
    const agentProcesses = getAgentProcesses(agentRegistry.agents);
    const scanInput = confProjects.map(({ tab, dir, sessionLifecycleSignals }) => {
      const resolvedTab = resolveEffectiveTab(tab, liveTabCache);
      const projectProcesses = agentProcesses.filter(
        (p) => p.cwd === dir || p.cwd.startsWith(dir + "/"),
      );
      return {
        tab: resolvedTab,
        dir,
        activeAgents: [...new Set(projectProcesses.map((p) => p.agentId))],
        sessionLifecycleSignals:
          projectProcesses.length > 0
            ? projectProcesses.some((p) => p.sessionLifecycleSignals)
            : sessionLifecycleSignals,
        tabOpen: liveTabCache.some((t) => t.toLowerCase() === resolvedTab.toLowerCase()),
      };
    });
    const agentCwds = agentProcesses.map((p) => p.cwd);
    const fast = readFastState(scanInput, agentCwds);
    // DB fallback so the local stream matches the /api/control GET (file ?? db).
    // Without it a project whose session .md is absent but whose project_states
    // row persists shows null here while the GET shows the row — the SSE/GET
    // divergence that hid the auto-reroute banner. resolveProjectSession is the
    // shared SSOT; fast[i] aligns with confProjects[i] (same map order). The DB
    // hit only happens when some session came back null (rare), not every tick.
    if (!fast.some((p) => p.session === null)) return fast;
    const dbRows = await getProjectStatesByUserIds(ownerIds).catch((): DbProjectState[] => []);
    const byKey = new Map(dbRows.map((r) => [`${r.userId}:${normalizeTabName(r.projectKey)}`, r]));
    return fast.map((p, i) => {
      const dbRow = byKey.get(
        `${confProjects[i].ownerUserId}:${normalizeTabName(confProjects[i].tab)}`,
      );
      return {
        ...p,
        workspaceId: p.workspaceId ?? dbRow?.workspaceId ?? null,
        session: p.session ?? resolveProjectSession(null, dbRow),
      };
    });
  };

  let cleanup: (() => void) | null = null;
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      const send = (text: string) => {
        try {
          controller.enqueue(enc.encode(text));
        } catch {
          /* client disconnected */
        }
      };

      const tick = async () => {
        refreshTabsCacheIfStale();
        const current = isRuntimeAvailable()
          ? await scanProjects()
          : dbToFastState(
              confProjects,
              await getProjectStatesByUserIds(ownerIds).catch((): DbProjectState[] => []),
            );
        // Connection-based presence rides every stream event so the online
        // badge flips in <1s (the bridge pg_notify's this channel on
        // connect/disconnect). See docs/architecture/connection-presence.md.
        const builderPresence = await getBuilderPresence(userId).catch(
          () => lastBuilderPresence ?? { cloud: false, local: false, any: false },
        );
        const runnerConnected = builderPresence.any;

        const agentsKey = (a: string[]) => [...a].sort().join(",");
        const changed = current.filter((proj, i) => {
          const prev = lastSent[i];
          if (!prev) return true;
          return (
            proj.agentRunning !== prev.agentRunning ||
            proj.tabOpen !== prev.tabOpen ||
            proj.readyAt !== prev.readyAt ||
            proj.lockAt !== prev.lockAt ||
            proj.closingAt !== prev.closingAt ||
            proj.closedAt !== prev.closedAt ||
            proj.currentPrompt?.key !== prev.currentPrompt?.key ||
            proj.currentPrompt?.startedAt !== prev.currentPrompt?.startedAt ||
            proj.session?.mtime !== prev.session?.mtime ||
            agentsKey(proj.activeAgents) !== agentsKey(prev.activeAgents)
          );
        });

        // Push when projects changed OR presence flipped — a pure
        // connect/disconnect must still update the badge.
        const presenceChanged =
          !lastBuilderPresence ||
          lastBuilderPresence.cloud !== builderPresence.cloud ||
          lastBuilderPresence.local !== builderPresence.local;
        if (changed.length > 0 || runnerConnected !== lastRunnerConnected || presenceChanged) {
          lastSent = current;
          lastRunnerConnected = runnerConnected;
          lastBuilderPresence = builderPresence;
          send(
            sseEvent("projects-update", { projects: current, runnerConnected, builderPresence }),
          );
          if (keepaliveTimer) {
            clearTimeout(keepaliveTimer);
            keepaliveTimer = null;
          }
          scheduleKeepalive();
        }
      };

      const scheduleKeepalive = () => {
        keepaliveTimer = setTimeout(() => {
          send(": keepalive\n\n");
          scheduleKeepalive();
        }, SSE_KEEPALIVE_MS);
      };

      // Initial snapshot
      const initialProjects = isRuntimeAvailable()
        ? await scanProjects()
        : dbToFastState(
            confProjects,
            await getProjectStatesByUserIds(ownerIds).catch((): DbProjectState[] => []),
          );
      lastSent = initialProjects;
      lastBuilderPresence = await getBuilderPresence(userId).catch(() => ({
        cloud: false,
        local: false,
        any: false,
      }));
      lastRunnerConnected = lastBuilderPresence.any;
      send(
        sseEvent("projects-update", {
          projects: lastSent,
          runnerConnected: lastRunnerConnected,
          builderPresence: lastBuilderPresence,
        }),
      );
      scheduleKeepalive();

      // Guard against concurrent ticks — events can fire faster than a tick completes.
      let tickRunning = false;
      const scheduledTick = () => {
        if (tickRunning) return;
        tickRunning = true;
        tick()
          .catch((err) => console.error("[control/stream] tick failed:", err))
          .finally(() => {
            tickRunning = false;
          });
      };

      // Event-driven: runner HTTP push → emitStateChanged → wake this stream immediately.
      const onStateChanged = () => scheduledTick();
      sseBus.on(`state:${userId}`, onStateChanged);

      // Local-only: /tmp sentinel file changed → check if it belongs to one of our projects.
      const tabSet = new Set(confProjects.map((p) => p.tab.toLowerCase()));
      const onSentinelChanged = (tab: string) => {
        if (tabSet.has(tab.toLowerCase())) scheduledTick();
      };
      sseBus.on("sentinel-changed", onSentinelChanged);

      // Cloud host only: Postgres LISTEN/NOTIFY for sub-second state propagation,
      // through ONE shared listener per process (src/lib/control-notify.ts).
      const unsubscribeNotify = !isRuntimeAvailable()
        ? subscribeControlNotify(userId, scheduledTick)
        : () => {};

      // Fallback tick — much longer now that events cover real-time changes.
      const FALLBACK_TICK_MS = isRuntimeAvailable() ? 10_000 : 5_000;
      const interval = setInterval(scheduledTick, FALLBACK_TICK_MS);

      // Cleanup when the client disconnects. A function returned from
      // start() is ignored by ReadableStream, so it is stored and run from
      // cancel(); that is what leaked a Postgres connection per page view.
      cleanup = () => {
        clearInterval(interval);
        if (keepaliveTimer) clearTimeout(keepaliveTimer);
        sseBus.off(`state:${userId}`, onStateChanged);
        sseBus.off("sentinel-changed", onSentinelChanged);
        unsubscribeNotify();
      };
    },
    cancel() {
      cleanup?.();
      cleanup = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
