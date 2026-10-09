/**
 * One read of the fleet for a voice: the same tables the Control page and
 * Loki's fleet facts read (lib/agent/sources-fleet.ts), reduced to what can be
 * SAID. No paths, no tokens, no prompts — a snapshot travels to a phone that
 * may be in someone else's hand.
 *
 * Approvals ride only when the private zone is open on this device: the PIN
 * guards the Approvals page, so it guards their titles in a headphone too.
 * The snapshot says that it is locked rather than silently showing none.
 */
import { getProjects } from "@/db/queries/projects";
import { getRunnerConnected } from "@/db/queries/runner-presence";
import { getOpenAgentTurns } from "@/db/queries/agent-sessions";
import { listRecentRuns } from "@/db/queries/orchestration-runs";
import { getActiveAlerts } from "@/db/queries/alerts";
import { getPendingActions } from "@/db/queries/actions";
import { isPrivateZoneLocked } from "@/lib/private-zone";
import { ORCH_STATE } from "@/lib/orchestration/contract";
import { DAY_MS, MINUTE_MS } from "@/lib/constants/time";
import type { FleetSnapshot } from "@/lib/voice/briefing";

const RECENT_RUNS = 10;

function minutesSince(d: Date, now: number): number {
  return Math.max(0, Math.round((now - d.getTime()) / MINUTE_MS));
}

export async function loadFleetSnapshot(userId: string, now = Date.now()): Promise<FleetSnapshot> {
  const [projects, builder, turns, waiting, ended, alerts, locked] = await Promise.all([
    getProjects(userId).catch(() => []),
    getRunnerConnected(userId).catch(() => null),
    getOpenAgentTurns(userId, new Date(now)).catch(() => []),
    listRecentRuns(userId, { states: [ORCH_STATE.WAITING], limit: 50 }).catch(() => []),
    listRecentRuns(userId, {
      states: [ORCH_STATE.DONE, ORCH_STATE.CLOSED, ORCH_STATE.ERROR],
      limit: RECENT_RUNS,
      sinceMs: DAY_MS,
    }).catch(() => []),
    getActiveAlerts(userId).catch(() => []),
    isPrivateZoneLocked(userId).catch(() => true),
  ]);
  const approvals = locked ? [] : await getPendingActions(userId).catch(() => []);

  // One entry per project: several open turns on one project (worktrees) are
  // one agent "working" to a listener.
  const workingByProject = new Map<string, number>();
  for (const t of turns) {
    const min = minutesSince(t.startedAt, now);
    const prev = workingByProject.get(t.projectKey);
    workingByProject.set(t.projectKey, prev === undefined ? min : Math.max(prev, min));
  }

  return {
    at: new Date(now).toISOString(),
    builderOnline: builder,
    projects: projects.map((p) => p.name),
    working: [...workingByProject].map(([project, sinceMin]) => ({ project, sinceMin })),
    waitingForBuilder: waiting.map((r) => ({
      project: r.projectKey,
      sinceMin: minutesSince(r.startedAt, now),
    })),
    recentRuns: ended.map((r) => {
      const failed =
        r.state === ORCH_STATE.ERROR || r.outcome === "error" || r.outcome === "timeout";
      return {
        id: r.id,
        project: r.projectKey,
        failed,
        finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
        note: failed ? (r.error ?? r.note ?? null) : (r.summaryDone ?? r.note ?? null),
      };
    }),
    alerts: alerts.map((a) => ({ id: a.id, title: a.title, severity: a.severity })),
    approvals: approvals.map((a) => ({ id: a.id, title: a.title, type: a.type })),
    approvalsLocked: locked,
  };
}
