/**
 * Fleet kick — batch-start development loops across one, some, or all projects.
 *
 * Play/pause enables reactive autopilot (agent finishes → next task). Fleet kick
 * is the proactive half: enqueue next_best on eligible idle projects now, capped
 * by MAX_CONCURRENT_BUILDING so the fleet doesn't cold-start everything at once.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema/entities";
import { orchestrationRuns } from "@/db/schema/orchestration-runs";
import { getBeaconSettings } from "@/db/queries/beacon-settings";
import { hasOpenPendingForProject } from "@/db/queries/pending-commands";
import { isProjectBusy, STALE_RUN_MINUTES } from "@/db/queries/orchestration-runs";
import { getProjectStatesByUserId } from "@/db/queries/project-states";
import { getUserProjects } from "@/db/queries/user-projects";
import { getRunnerConnected } from "@/db/queries/runner-presence";
import { injectPrompt, type InjectResult } from "@/lib/inject-core";
import { DEFAULT_AUTO_INJECT_MODE, MAX_CONCURRENT_BUILDING } from "@/lib/constants/control";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import { ENTITY_TYPE, SESSION_STATUS } from "@/lib/constants/statuses";
import { normalizeAutoInjectMode, type AutoInjectMode } from "@/config/beacon";
import { normalizeKickScope, sortProjectsForKick } from "@/lib/fleet-kick-format";
export { formatFleetKickReply, sortProjectsForKick } from "@/lib/fleet-kick-format";

export type FleetKickSource = "play_button" | "loki" | "api" | "control_selected" | "start_my_day";

export type FleetKickDetail = {
  projectKey: string;
  outcome: "kicked" | "skipped";
  reason?: string;
};

export type FleetKickResult = {
  ok: boolean;
  source: FleetKickSource;
  runnerConnected: boolean;
  fleetMode: AutoInjectMode;
  kicked: number;
  activeBefore: number;
  slotsAvailable: number;
  details: FleetKickDetail[];
  skipped: Record<string, number>;
  message: string;
};

export type FleetKickOptions = {
  source: FleetKickSource;
  /** When set, only consider these project names (case-insensitive). */
  projectKeys?: string[];
  /** When false, skip projects whose fleet/user autopilot is off. Loki/API may pass true. */
  requireFleetOn?: boolean;
};

async function countActiveRuns(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orchestrationRuns)
    .where(
      and(
        eq(orchestrationRuns.userId, userId),
        isNull(orchestrationRuns.finishedAt),
        sql`${orchestrationRuns.startedAt} > NOW() - INTERVAL '1 minute' * ${STALE_RUN_MINUTES}`,
      ),
    );
  return row?.n ?? 0;
}

export async function loadProjectOverrides(
  userId: string,
): Promise<Map<string, AutoInjectMode | null>> {
  const rows = await db
    .select({ name: entities.name, override: entities.autoInjectModeOverride })
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.type, ENTITY_TYPE.PROJECT)));
  const map = new Map<string, AutoInjectMode | null>();
  for (const r of rows) {
    map.set(r.name.toLowerCase(), r.override ? normalizeAutoInjectMode(r.override) : null);
  }
  return map;
}

export async function kickFleet(userId: string, opts: FleetKickOptions): Promise<FleetKickResult> {
  const skipped: Record<string, number> = {
    paused: 0,
    no_path: 0,
    pending_command: 0,
    busy: 0,
    concurrency_cap: 0,
    not_in_scope: 0,
    inject_failed: 0,
  };
  const details: FleetKickDetail[] = [];

  const settings = await getBeaconSettings(userId).catch(() => null);
  const fleetMode = normalizeAutoInjectMode(settings?.auto_inject_mode ?? DEFAULT_AUTO_INJECT_MODE);
  const runnerConnected = await getRunnerConnected(userId);

  if (opts.requireFleetOn !== false && fleetMode === "off") {
    return {
      ok: false,
      source: opts.source,
      runnerConnected,
      fleetMode,
      kicked: 0,
      activeBefore: 0,
      slotsAvailable: 0,
      details,
      skipped,
      message: "Fleet autopilot is paused — press **Start building** on Control first.",
    };
  }

  const scope = normalizeKickScope(opts.projectKeys);
  const [projects, overrides, states, activeBefore] = await Promise.all([
    getUserProjects(userId),
    loadProjectOverrides(userId),
    getProjectStatesByUserId(userId),
    countActiveRuns(userId),
  ]);

  const readyKeys = new Set(
    states
      .filter((s) => s.sessionStatus === SESSION_STATUS.READY || s.readyAt)
      .map((s) => s.projectKey.toLowerCase()),
  );

  const activeProjects = projects
    .filter((p) => p.isActive !== false)
    .map((p) => ({ name: p.name, dirPath: p.dirPath }));

  const projectByName = new Map(activeProjects.map((p) => [p.name.toLowerCase(), p]));
  const orderedNames =
    opts.source === "start_my_day" && opts.projectKeys
      ? opts.projectKeys.flatMap((key) => {
          const project = projectByName.get(key.toLowerCase());
          return project ? [project.name] : [];
        })
      : sortProjectsForKick(
          activeProjects.map((p) => p.name),
          readyKeys,
        );
  const candidates = orderedNames.filter((name) => {
    const lower = name.toLowerCase();
    if (scope && !scope.has(lower)) {
      skipped.not_in_scope++;
      return false;
    }
    const override = overrides.get(lower);
    if (override === "off") {
      skipped.paused++;
      details.push({ projectKey: name, outcome: "skipped", reason: "paused" });
      return false;
    }
    return true;
  });

  let slotsAvailable = Math.max(0, MAX_CONCURRENT_BUILDING - activeBefore);
  let kicked = 0;

  for (const projectKey of candidates) {
    if (slotsAvailable <= 0) {
      skipped.concurrency_cap++;
      details.push({ projectKey, outcome: "skipped", reason: "concurrency_cap" });
      continue;
    }

    if (!projectByName.get(projectKey.toLowerCase())?.dirPath) {
      skipped.no_path++;
      details.push({ projectKey, outcome: "skipped", reason: "no_path" });
      continue;
    }

    if (await hasOpenPendingForProject(userId, projectKey)) {
      skipped.pending_command++;
      details.push({ projectKey, outcome: "skipped", reason: "pending_command" });
      continue;
    }

    if (await isProjectBusy(userId, projectKey)) {
      skipped.busy++;
      details.push({ projectKey, outcome: "skipped", reason: "busy" });
      continue;
    }

    const inject = await injectPrompt(
      {
        tab: projectKey,
        promptKey: "next_best",
        notifyOnClose: opts.source === "start_my_day" ? true : undefined,
      },
      userId,
    ).catch((): InjectResult => ({
      status: 503,
      body: { error: "Could not confirm dispatch — check Control before retrying" },
    }));
    if (inject.status >= 400) {
      skipped.inject_failed++;
      const err = typeof inject.body.error === "string" ? inject.body.error : "inject failed";
      details.push({ projectKey, outcome: "skipped", reason: err });
      continue;
    }
    if (inject.body.blocked === true) {
      skipped.busy++;
      details.push({ projectKey, outcome: "skipped", reason: "blocked" });
      continue;
    }

    kicked++;
    slotsAvailable--;
    details.push({ projectKey, outcome: "kicked" });
  }

  const message = formatFleetKickMessage({
    kicked,
    activeBefore,
    runnerConnected,
  });

  return {
    ok: true,
    source: opts.source,
    runnerConnected,
    fleetMode,
    kicked,
    activeBefore,
    slotsAvailable: Math.max(0, MAX_CONCURRENT_BUILDING - activeBefore - kicked),
    details,
    skipped,
    message,
  };
}

function formatFleetKickMessage(input: {
  kicked: number;
  activeBefore: number;
  runnerConnected: boolean;
}): string {
  if (input.kicked > 0) {
    const base = input.runnerConnected
      ? EXECUTOR_COPY.fleetKick.started(input.kicked)
      : EXECUTOR_COPY.fleetKick.startedQueued(input.kicked);
    return `${base} (max **${MAX_CONCURRENT_BUILDING}** concurrent).`;
  }
  if (input.activeBefore >= MAX_CONCURRENT_BUILDING) {
    return EXECUTOR_COPY.fleetKick.slotsBusy(MAX_CONCURRENT_BUILDING);
  }
  return EXECUTOR_COPY.fleetKick.nothingToKick;
}
