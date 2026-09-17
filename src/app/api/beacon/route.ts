// Beacon popup creation + helpers — Change 4 (DB-backed).
//
// Previously this module wrote one JSON file per session to
// /tmp/<APP_SLUG>-beacon/<id>.json and read directly from the filesystem.
// That worked but had three drawbacks (see src/db/schema/beacon-sessions.ts
// for the rationale). The migration is a near-1:1 swap: the route shapes
// stay the same, just the storage moves to a DB table.
//
// Backward-compat: the named exports beaconPath / readBeaconSession /
// readLatestPendingSession / cancelActiveBeaconSessions kept their names
// where call sites depend on them; the implementations now delegate to
// src/db/queries/beacon-sessions.ts. beaconPath no longer makes sense for
// DB-backed storage and is removed — its three call sites switched to
// direct getBeaconSession() calls.

import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import {
  isAgentId,
  looksLikeAgentCapacityIssue,
  resolveNextAvailableAgent,
  type Agent,
} from "@/lib/agent-registry";
import { DEFAULT_BEACON_COUNTDOWN_S, DEFAULT_POPUP_MODE } from "@/lib/constants/control";
import { getApiUserId } from "@/lib/session";
import { denyDemoInHandler } from "@/lib/demo-guard";
import { getBeaconSettings } from "@/db/queries/beacon-settings";
import { getProjectAutopilotOverride } from "@/db/queries/projects";
import { getUserProjects } from "@/db/queries/user-projects";
import { getUserPreferences } from "@/db/queries/user-preferences";
import { parseProviderOrder } from "@/lib/provider-switch";
import { enqueueSwitchAgentCommand, recentSwitchAgentStats } from "@/db/queries/pending-commands";
import { decideHeadlessReroute, MAX_AUTO_REROUTES_PER_WINDOW } from "@/lib/auto-reroute";
import { resolveQueuedExecution } from "@/lib/execution-access";
import {
  createBeaconSession,
  getBeaconSession as getBeaconSessionFromDb,
  getLatestPendingSession as getLatestPendingSessionFromDb,
  cancelActiveBeaconSessions as cancelActiveBeaconSessionsInDb,
  purgeOldBeaconSessions,
  type BeaconSession,
} from "@/db/queries/beacon-sessions";

/**
 * Headless auto-reroute: when an agent's session ends on a capacity wall and
 * the project's autopilot is on, queue a switch to the next installed agent —
 * no browser needed (the /control path only fires while the page is open).
 * Mirrors decideAutoReroute; loop safety is a DB guard (cap per window + skip
 * while a switch is still unclaimed) since there's no client ref to lean on.
 * Best-effort: never blocks or fails beacon creation.
 */
async function maybeAutoRerouteOnCapacity(
  userId: string,
  projectName: string,
  fromAgent: string | null,
  nextAgent: string | null,
): Promise<void> {
  const [override, settings, projects, guard] = await Promise.all([
    getProjectAutopilotOverride(userId, projectName),
    getBeaconSettings(userId),
    getUserProjects(userId),
    recentSwitchAgentStats(userId, projectName),
  ]);
  const mode = override ?? settings.auto_inject_mode;
  const project = projects.find((p) => p.name === projectName);

  const decision = decideHeadlessReroute({
    capacityIssue: true,
    automationOn: mode === "on",
    nextAgent,
    hasDir: !!project?.dirPath,
    hasPendingSwitch: guard.pending > 0,
    recentSwitchCount: guard.windowCount,
    maxSwitchesPerWindow: MAX_AUTO_REROUTES_PER_WINDOW,
  });
  if (!decision.reroute) return;
  const execution = await resolveQueuedExecution(userId, { defaultChannel: "cloud" });
  if (!execution.ok) {
    console.log(`[beacon] auto-reroute skipped: ${projectName} ${execution.code}`);
    return;
  }

  await enqueueSwitchAgentCommand(userId, {
    tab: project!.name,
    ...(execution.channel ? { channel: execution.channel } : {}),
    dir: project!.dirPath!,
    toAgent: decision.toAgent,
    fromAgent: fromAgent ?? undefined,
  });
  console.log(
    `[beacon] auto-reroute queued: ${projectName} ${fromAgent ?? "?"}→${decision.toAgent}`,
  );
}

// Re-export the type so callers that imported BeaconSession from this
// module continue to work without touching their imports.
export type { BeaconSession };

async function readConfiguredSettings(
  userId: string | null,
): Promise<{ countdownSeconds: number; popupMode: string }> {
  if (userId) {
    try {
      const s = await getBeaconSettings(userId);
      return { countdownSeconds: s.countdown_seconds, popupMode: s.popup_mode };
    } catch {
      /* DB hiccup — fall through to defaults */
    }
  }
  return { countdownSeconds: DEFAULT_BEACON_COUNTDOWN_S, popupMode: DEFAULT_POPUP_MODE };
}

const CreateBody = z.object({
  project: z.string().max(200),
  sessionContent: z.string().max(20_000).default(""),
  currentAgent: z.string().max(40).optional(),
});

/** Read a beacon session by id. Backward-compatible name for callers that
 *  used the file-based version. Async now because storage is async. */
export async function readBeaconSession(id: string): Promise<BeaconSession | null> {
  return getBeaconSessionFromDb(id);
}

/** Most recent pending session for the caller's user. SSR-preload helper
 *  used by /beacon/live. Async now (was sync filesystem read).
 *
 *  Note: file version was userId-agnostic (it just scanned /tmp). DB
 *  version is user-scoped — safer, and the file version's lack of
 *  scoping was incidental rather than intentional. */
export async function readLatestPendingSession(userId: string): Promise<BeaconSession | null> {
  return getLatestPendingSessionFromDb(userId);
}

/**
 * Cancel any active beacon sessions for the given (user, tab). Setting
 * choice to "" preserves the file-based contract — beacon.py's polling
 * loop and the popup page both treat "" as "close cleanly." Called by
 * /api/inject so panel injections don't race with an open popup.
 *
 * The file version took only `tab` and scanned all sessions globally; the
 * DB version is properly user-scoped. Existing call sites that don't have
 * a userId in scope must add one (small fix at the call site).
 */
export async function cancelActiveBeaconSessions(userId: string, tab: string): Promise<number> {
  return cancelActiveBeaconSessionsInDb(userId, tab);
}

export async function POST(req: NextRequest) {
  const dataOrResp = await readJsonBody(req, CreateBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  // Best-effort purge of stale rows on every create — matches the file
  // version's purge-on-POST behavior. Errors don't block the new session.
  purgeOldBeaconSessions().catch(() => {});

  const userId = await getApiUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Beacon escalates to a real agent on a real machine. /api/beacon is
  // matcher-excluded (the popup polls it pre-session), so the demo gate has to
  // live here — see DEMO_HANDLER_ENFORCED in src/config/demo.ts.
  const demoDenied = await denyDemoInHandler(userId, "dispatch");
  if (demoDenied) return demoDenied;

  const { countdownSeconds, popupMode } = await readConfiguredSettings(userId);

  const currentAgent: Agent | null = isAgentId(dataOrResp.currentAgent)
    ? dataOrResp.currentAgent
    : "claude";
  // The operator's ranking, not the fleet's. This is the HEADLESS reroute: it
  // fires on a capacity wall with nobody watching, so a fallback that ignored
  // the order set in Settings → Agent would quietly move work onto a provider
  // the operator had deliberately ranked last, and they would only find out
  // from the run history.
  const providerOrder = parseProviderOrder(
    (await getUserPreferences(userId).catch(() => null))?.agentOrder ?? null,
  );
  const nextAgent = resolveNextAvailableAgent(
    dataOrResp.currentAgent ?? "claude",
    providerOrder ?? undefined,
  );
  const capacityIssue = looksLikeAgentCapacityIssue(dataOrResp.sessionContent);

  const id = await createBeaconSession({
    userId,
    project: dataOrResp.project,
    sessionContent: dataOrResp.sessionContent,
    currentAgent,
    nextAgent,
    capacityIssue,
    countdownSeconds,
    popupMode,
  });

  // Headless reroute on a capacity wall — best-effort, never blocks the beacon.
  if (capacityIssue && nextAgent) {
    try {
      await maybeAutoRerouteOnCapacity(userId, dataOrResp.project, currentAgent, nextAgent);
    } catch (e) {
      console.error("[beacon] auto-reroute failed:", e);
    }
  }

  return NextResponse.json({ id });
}
