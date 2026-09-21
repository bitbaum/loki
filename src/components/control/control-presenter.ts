import {
  ACTIVE_WINDOW_S,
  AGENT_ABSENT_GRACE_S,
  CLOSED_WINDOW_S,
  CLOSING_WINDOW_S,
  READY_WINDOW_S,
  withinWindow,
} from "@/lib/constants/control";
import { timeAgo } from "@/lib/dates";
import { ORCH_STATE } from "@/lib/orchestration/contract";
import { SESSION_STATUS } from "@/lib/constants/statuses";
import { AGENT_LABELS, type AnyAgentId } from "@/lib/agent-labels";
import { inferAdapterFromTabName } from "@/lib/agent-resolution";
import { STATE_DEFINITIONS, type ProjectStateKey } from "@/lib/control-states";

export { inferAdapterFromTabName } from "@/lib/agent-resolution";
import type { ControlData, ProjectState } from "@/lib/control-types";
import type { OrchestrationOutcome } from "@/db/schema/orchestration-runs";
import { isFailingOutcome } from "@/lib/events";
import { latestActivitySummary } from "./project-activity-ledger";
import { DAY_MS } from "@/lib/constants/time";
import { RUNNER_OFFLINE_THRESHOLD_MS } from "@/lib/constants/runner";

export type RuntimeSyncContext = {
  /** True when the cloud has never received a runner runtime-state push. */
  stateUnknown?: boolean;
  /** True when the last runner push is older than the offline threshold. */
  syncStale?: boolean;
  /** ISO timestamp of the last successful runtime-state push from the local runner. */
  lastSyncedAt?: string | null;
};

function staleSyncLabel(lastSyncedAt: string | null | undefined): string {
  if (!lastSyncedAt) return "Last sync unknown";
  return `Last sync ${timeAgo(new Date(lastSyncedAt).getTime())}`;
}

/**
 * Hard cap (seconds) on how old a currentPrompt can be before we declare it
 * stale — see isCurrentPromptStale. Codex has no Stop hook (interactive TUI)
 * so the /tmp/agent-current-prompt-<tab> sentinel can linger forever after
 * the agent finishes — without this gate the UI shows "Codex working 61h" on
 * a dead tab. 30 minutes is the longest a single agent task should plausibly
 * run; longer real work writes intermediate session files so the mtime-based
 * signal fires first.
 */
const STALE_PROMPT_S = 30 * 60;

/** How recent a dispatch/run must be for an otherwise-idle project to show
 *  "Active recently" instead of "Not running". 3h: long enough to cover a
 *  working session between hook-captured dispatches, short enough that
 *  yesterday's work doesn't read as current. */
export const RECENTLY_ACTIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * True when the recorded currentPrompt is no longer trustworthy. Layered
 * signals (positive → time-based fallback):
 *  1. Agent self-reported `session.status === "ready"` (Claude path).
 *  2. Session file rewritten after the prompt started — the agent wrote a
 *     handoff so the work cycle closed even if the Stop hook never cleared
 *     the sentinel (Codex path).
 *  3. Hard time cap. Catches agents that never write a session file at all.
 */
export function isCurrentPromptStale(project: ProjectState, nowS: number): boolean {
  if (!project.currentPrompt) return false;
  const startedAt = project.currentPrompt.startedAt;
  if (!startedAt) return false;

  const sessionStatus = project.session?.status?.trim().toLowerCase();
  if (sessionStatus === SESSION_STATUS.READY) return true;
  // Agents mid-task update the handoff file with status: working — that must
  // not clear the live "Working" badge (was causing false "Open, idle").
  if (sessionStatus === SESSION_STATUS.WORKING) {
    return nowS - startedAt > STALE_PROMPT_S;
  }

  // No live agent process for a LOCALLY dispatched prompt → the agent exited
  // or never launched, so the "Working" badge is a false positive. A sentinel
  // with source "inject" is only ever written by the local /api/inject and
  // /api/control/tab-inject routes (cloud skips the /tmp write), which means a
  // real /proc scan backs `agentRunning` here — it is authoritative. We wait
  // out AGENT_ABSENT_GRACE_S first so a freshly-dispatched prompt isn't killed
  // before its agent has had time to appear in /proc. Sentinels held by the
  // cloud runner (source "runner") are intentionally exempt: there is no local
  // /proc scan to trust, and the runner clears its own sentinel. This is the
  // fix for the stale "Working 20m" on an idle shell where a queued/never-
  // delivered dispatch left an "inject" sentinel with no agent behind it.
  if (
    project.currentPrompt.source === "inject" &&
    !project.agentRunning &&
    nowS - startedAt > AGENT_ABSENT_GRACE_S
  ) {
    return true;
  }

  // SessionState.mtime is used for Date display elsewhere and remains milliseconds;
  // lifecycle sentinels and prompt startedAt are epoch seconds.
  const sessionMtimeS = project.session?.mtime ? Math.floor(project.session.mtime / 1000) : 0;
  if (sessionMtimeS > startedAt + 5) return true;

  if (nowS - startedAt > STALE_PROMPT_S) return true;

  return false;
}

export type ProjectDisplayState = {
  isClosed: boolean;
  isClosing: boolean;
  isReady: boolean;
  isOrchestrationReady: boolean;
  isBeaconActive: boolean;
  isRunning: boolean;
  /** WHICH signal made isRunning true. The evidence line names this rather
   *  than asserting a /proc hit for all of them: only "process" is a detected
   *  agent process. Control read "Working · Live agent process detected" for a
   *  project whose own API reported agentRunning=false and activeAgents=[]
   *  (2026-09-17) — the state was right, the stated reason was invented. */
  runningEvidence: "process" | "live-turn" | "run-output" | "dispatched-prompt" | null;
  /** SSOT for "is the agent actively working right now?" — chip + badge read this. */
  isAgentWorking: boolean;
  isSessionOpen: boolean;
  isActive: boolean;
  showRunningBanner: boolean;
  showLatestOrchestration: boolean;
  tabOpen: boolean;
  tone:
    | "offline"
    | "running"
    | "session-open"
    | "ready"
    | "orchestration-ready"
    | "closing"
    | "closed"
    | "idle";
  /** SSOT key for this state — index into STATE_DEFINITIONS for label,
   *  description, dot color, problem hint, counter category. All downstream
   *  consumers (chips, rows, banner, tooltip, agent prompt context) should
   *  read from here, not from the legacy `tone` / `stateLabel` fields. */
  stateKey: ProjectStateKey;
  /** Human-readable label for the state badge — derived from
   *  STATE_DEFINITIONS[stateKey].label (kept here for transitional access
   *  during the consumer migration; new code should call
   *  projectStateLabel(stateKey) directly). */
  stateLabel: string;
  /** Tailwind classes for the ui-tag badge — derived from
   *  STATE_DEFINITIONS[stateKey].tagClass. */
  stateTagClass: string;
};

/** Legacy ControlPhase enum — retained as an alias of ProjectStateKey while
 *  callers migrate. New code should use ProjectStateKey directly. The
 *  values are identical so the migration is purely nominal. */
export type ControlPhase = ProjectStateKey;

/** Status-dot color class per state. Sourced from the SSOT
 *  (`STATE_DEFINITIONS[k].dotClass`) so the dot, badge, tooltip, and counter
 *  cannot disagree — adding a state forces an explicit dot class in one
 *  place. The Record below is just a typed cache to keep call-site syntax
 *  stable for components that index it directly. */
export const PHASE_DOT_CLASS: Record<ControlPhase, string> = Object.fromEntries(
  (Object.keys(STATE_DEFINITIONS) as ProjectStateKey[]).map((k) => [
    k,
    STATE_DEFINITIONS[k].dotClass,
  ]),
) as Record<ProjectStateKey, string>;

export type ProjectOperationsSnapshot = {
  project: ProjectState;
  phase: ControlPhase;
  display: ProjectDisplayState;
  evidenceLabel: string;
  evidenceAt: number | null;
  evidenceKind: "live" | "historical" | "unknown";
  contextSummary: string | null;
  attentionReason: string | null;
};

export type ControlDashboardState = {
  /**
   * False while the runner has never reported runtime state.
   *
   * Without runtime state getProjectDisplayState classifies every project as
   * `offline`, whose counterCategory is "offline" — so all three live counts
   * read 0. That is not a partial answer, it is a confident wrong one: the
   * "All clear" chip fires on exactly `working === 0 && ready === 0 &&
   * idle === 0`, so Control would tell the operator the fleet is calm at the
   * precise moment it knows nothing about the fleet.
   *
   * Views must say "checking" rather than render the triad while this is false.
   * A fabricated stat is worse than an absent one, because it gets acted on.
   */
  countsKnown: boolean;
  runningCount: number;
  waitingCount: number;
  controlProjectCount: number;
  openTabCount: number;
  idleCount: number;
  commitsToday: number;
};

/** Truthful fleet-pulse for the Control hero. */
export type FleetPulse = {
  key: "paused" | "building" | "waiting" | "failing" | "stalled" | "partial" | "inbox" | "unknown";
  label: string;
  /** Secondary sentence for the failing/stalled states ("failing" renders
   *  with an Activity link; "stalled" names the stuck projects inline). */
  detail: string | null;
};

/**
 * Derive what the fleet is ACTUALLY doing for the hero headline. The label
 * used to be `mode === "on" ? "Building" : "Paused"` — pure aspiration: it
 * showed "Building" with a pulsing green dot while 0 agents worked and every
 * recent run had failed (the 2026-07-02 dead-fleet incident sat behind a
 * green light for two days). Rules, in order:
 *   - autopilot off                        → "Paused"
 *   - any agent working right now          → "Building"
 *   - nothing working + the latest run of ≥2 projects failed and NONE
 *     succeeded                            → "Stalled" (+ detail, Activity link)
 *   - nothing working                      → "Waiting to dispatch"
 * user_abort counts as neutral (a human choice, not a systemic failure).
 *
 * Recency gate: a failure only counts toward "Stalled" if the run finished
 * RECENTLY. Without this, an old outage (e.g. the box-credential expiry that
 * timed out 18 projects) kept the hero red for weeks — every project's LATEST
 * outcome was a two-week-old timeout, so `failed` stayed high while the fleet
 * was merely idle. "Stalled" must mean "failing now", not "last failed once".
 */
export const FLEET_PULSE_STALE_MS = DAY_MS;

export type RunnerPresence = {
  /** Nothing can be dispatched: no builder is reachable. */
  runnerOffline: boolean;
  /** No builder has EVER pushed runtime state for this account. */
  runnerNeverSeen: boolean;
  /** Cached runtime state is worth showing (offline but once seen). */
  runtimeStateKnown: boolean;
  /** Offline with a last-known push — show state, label it stale. */
  runnerSyncStale: boolean;
  runtimeSyncCtx: RuntimeSyncContext;
};

/**
 * Is a builder there, and can we trust what it last told us?
 *
 * Presence is connection-based: an open runner↔bridge SSE connection
 * (runnerConnected === true) means online, full stop — the badge flips in
 * <1s without waiting on the heartbeat. ADDITIVE ROLLOUT: we do NOT treat
 * connected===false as authoritative offline yet, because a pre-rollout
 * runner (no client=runner tag) reports false while heartbeating fine —
 * so offline still requires a stale heartbeat. At cutover (once every runner
 * tags itself) this drops to `runnerConnected === false`.
 * See docs/architecture/connection-presence.md.
 *
 * runnerConnected === true  → online (cloud builder and/or desktop app).
 * runnerConnected === false → offline even if a stale heartbeat exists.
 * null                      → fall back to heartbeat age until the SSE event arrives.
 */
export function deriveRunnerPresence(input: {
  runtimeAvailable: boolean;
  runnerConnected: boolean | null;
  cloudBuilderPresent: boolean;
  runnerLastPushedAt: string | null;
  lastUpdated: number | null;
}): RunnerPresence {
  const {
    runtimeAvailable,
    runnerConnected,
    cloudBuilderPresent,
    runnerLastPushedAt,
    lastUpdated,
  } = input;
  const runnerAgoMs =
    lastUpdated && runnerLastPushedAt ? lastUpdated - new Date(runnerLastPushedAt).getTime() : null;
  const runnerOffline =
    !runtimeAvailable &&
    (runnerConnected === false ||
      (runnerConnected !== true &&
        !cloudBuilderPresent &&
        runnerAgoMs !== null &&
        runnerAgoMs > RUNNER_OFFLINE_THRESHOLD_MS));
  const runnerNeverSeen =
    !runtimeAvailable && runnerConnected !== true && runnerLastPushedAt === null;
  // Only hide cached runtime when the runner has never connected. When offline
  // but we have a last push, show last-known Working/Ready state with a stale label.
  const runnerSyncStale = runnerOffline && runnerLastPushedAt !== null;
  return {
    runnerOffline,
    runnerNeverSeen,
    runtimeStateKnown: !runnerNeverSeen,
    runnerSyncStale,
    runtimeSyncCtx: { syncStale: runnerSyncStale, lastSyncedAt: runnerLastPushedAt },
  };
}

/** Each project's latest outcome paired with how long ago its latest run
 *  finished, so a stale outage doesn't read as "currently stalled". */
export function latestRunSignals(
  projects: ProjectState[],
  nowS: number,
): Array<{ outcome: OrchestrationOutcome; ageMs: number | null }> {
  return projects.flatMap((p) => {
    const outcome = p.recentOutcomes?.[0];
    if (!outcome) return [];
    const finishedAt = p.latestOrchestrationRun?.finishedAt;
    return [{ outcome, ageMs: finishedAt ? nowS * 1000 - Date.parse(finishedAt) : null }];
  });
}

/** Recent runs that stopped part-way. One definition, so the "Building" detail
 *  and the "Half-finished" verdict cannot disagree about the same runs. */
function recentPartials(
  latestRuns: { outcome: OrchestrationOutcome | null; ageMs: number | null }[],
): number {
  return latestRuns.filter(
    (r) => r.ageMs != null && r.ageMs <= FLEET_PULSE_STALE_MS && r.outcome === "partial",
  ).length;
}

export function deriveFleetPulse(input: {
  automationMode: string;
  workingCount: number;
  /** Projects awaiting the USER (ready / open_idle buckets). Lets the quiet
   *  state say the truthful thing — "Waiting on you" — instead of implying
   *  the system is about to act. */
  waitingCount?: number;
  /** Latest run per project (projects with any finished run). `ageMs` = how long
   *  ago it finished; null = unknown age (open/newer run) → excluded from the
   *  stall signal since an active project isn't "stalled". */
  latestRuns: Array<{ outcome: OrchestrationOutcome; ageMs: number | null }>;
  /** Execution health from getRunnerExecutionStall — already filtered to
   *  GENUINE stalls (serialized/in-flight commands don't count). */
  executionStall?: {
    stalled: boolean;
    stalledCount: number;
    oldestSeconds: number;
    tabs?: string[];
  } | null;
  /** The "Needs you" queue — feedback awaiting triage plus sites missing the
   *  widget. The hero's whole brief is "is anything waiting on me?", and until
   *  this argument existed it answered that question without reading the one
   *  queue on the page that literally counts things waiting on the operator:
   *  it printed "Idle — nothing queued" above a panel badged 6. `unknown` is
   *  distinct from `count: 0` on purpose — a queue we failed to read is not a
   *  queue we know to be empty. */
  inbox?: { count: number; unknown: boolean } | null;
}): FleetPulse {
  if (input.automationMode === "off") return { key: "paused", label: "Paused", detail: null };
  // A genuine execution stall outranks "Building": an observed terminal
  // process doesn't prove the dispatch pipeline works, and showing a pulsing
  // green "Building · 1 agent active" directly above "N queued for Xm" was
  // the exact contradiction the 2026-08-13 review flagged.
  const stall = input.executionStall;
  if (stall?.stalled) {
    const mins = Math.max(1, Math.round(stall.oldestSeconds / 60));
    const who = stall.tabs && stall.tabs.length > 0 ? ` (${stall.tabs.join(", ")})` : "";
    return {
      key: "stalled",
      label: "Stalled",
      detail: `${stall.stalledCount} dispatch${stall.stalledCount === 1 ? "" : "es"} queued for ${mins}m${who} — the builder is connected but not executing them. Restart the desktop app or check the cloud builder if this persists.`,
    };
  }
  if (input.workingCount > 0) {
    // Building is the honest HEADLINE while an agent works, and it used to
    // return here with `detail: null` — which is why a project showing "5 of
    // last 5 partial" sat under a hero that said only "Building", with no hint
    // that nothing had actually landed recently. The label stays; the silence
    // does not.
    const stalling = recentPartials(input.latestRuns);
    return {
      key: "building",
      label: "Building",
      detail:
        stalling >= 2
          ? `Working now — but the last run on ${stalling} project${stalling === 1 ? "" : "s"} only got part-way. Worth checking what it left behind.`
          : null,
    };
  }

  const recent = input.latestRuns.filter((r) => r.ageMs != null && r.ageMs <= FLEET_PULSE_STALE_MS);
  const failed = recent.filter((r) => isFailingOutcome(r.outcome)).length;
  // `partial` is NOT evidence of health.
  //
  // It used to be counted here alongside `success`, which meant a fleet whose
  // every recent run came back partial could never reach the failing state:
  // `succeeded` was non-zero, so the check below could not fire. Two feet away
  // on the same screen, OutcomeStreak renders the same outcome with
  // `ui-tag-warning` and the words "5 of last 5 partial". One fact, graded two
  // ways, in one view — and the forgiving reading was the one driving the
  // headline.
  //
  // `partial` is correctly excluded from FAILING_OUTCOMES: a run that delivered
  // something is not a hard failure, and the dispatch brake should not trip on
  // it. But "not a failure" and "proof things are working" are different
  // claims, and only the first one is true.
  const succeeded = recent.filter((r) => r.outcome === "success").length;
  const partial = recent.filter((r) => r.outcome === "partial").length;
  if (failed >= 2 && succeeded === 0) {
    return {
      key: "failing",
      label: "Stalled",
      detail: `The latest run on ${failed} project${failed === 1 ? "" : "s"} failed and nothing is currently building.`,
    };
  }
  // Nothing is working and nothing failed recently. "Waiting to dispatch"
  // was the old catch-all here — it implied the system was about to act even
  // when the queue was empty and the only thing anyone was waiting on was
  // the HUMAN (1 project sat "Awaiting input" under a hero promising
  // imminent dispatch, 2026-08-13 review). Say which quiet state it is.
  // Nothing failed outright, but nothing finished either. Before this, such a
  // fleet fell through to "Idle — nothing queued", which reads as a clean desk
  // when it is actually a pile of half-finished work.
  if (partial >= 2 && succeeded === 0) {
    return {
      key: "partial",
      label: "Half-finished",
      detail: `The last run on ${partial} project${partial === 1 ? "" : "s"} stopped part-way — it delivered something, but not what was asked. Open the project to see what is missing.`,
    };
  }
  if ((input.waitingCount ?? 0) > 0) {
    const n = input.waitingCount!;
    return {
      key: "waiting",
      label: "Waiting on you",
      detail: `${n} project${n === 1 ? "" : "s"} awaiting your input — autopilot doesn't interrupt a session that's waiting on you.`,
    };
  }
  // Ranked LAST among the states that say something is up, and deliberately so:
  // these are small chores, not a blocked fleet, so a stall, a failure, a
  // half-finished run or a project awaiting input all outrank them. But they
  // comfortably outrank "Idle", because they are the literal answer to the
  // question this hero asks.
  const inbox = input.inbox;
  if (inbox && inbox.count > 0) {
    return {
      key: "inbox",
      label: "Waiting on you",
      detail:
        `${inbox.count} small thing${inbox.count === 1 ? "" : "s"} to review — ` +
        `feedback to triage and sites missing the widget. See “Needs you” below.`,
    };
  }
  if (inbox?.unknown) {
    return {
      key: "unknown",
      label: "Nothing queued",
      detail: "Couldn’t read the review queue, so this is not a claim that nothing needs you.",
    };
  }
  return { key: "waiting", label: "Idle — nothing queued", detail: null };
}

export type AttentionItem = {
  project: ProjectState;
  score: number;
  reason: string;
};

export type LiveTabRow = {
  tabName: string;
  project: ProjectState | null;
  agentLabel: string | null;
  /** SSOT key for this row's state, when a registered project backs it.
   *  Null for unmatched agent terminals ("Open" rows). Consumers look up
   *  description + problem from STATE_DEFINITIONS via this key. */
  stateKey: ProjectStateKey | null;
  stateLabel: ProjectDisplayState["stateLabel"] | "Open";
  stateTagClass: string;
  /** Running prompt label, or null when the state badge already says it all. */
  activity: string | null;
  isWorking: boolean;
  isWaiting: boolean;
  registered: boolean;
};

type LiveTabRankLabel = LiveTabRow["stateLabel"];

const LIVE_TAB_RANK: Record<LiveTabRankLabel, number> = {
  Offline: 0,
  Working: 0,
  "Ready for next step": 1,
  "Agent idle": 3,
  Closing: 2,
  Completed: 3,
  "Not running": 4,
  "Active recently": 4,
  "Tab open": 4,
  Open: 5,
};

/** Map an open agent terminal name back to a registered fleet project. */
export function findProjectForOpenTab(
  openTab: string,
  projects: ProjectState[],
): ProjectState | null {
  const lower = openTab.toLowerCase();
  const exact = projects.find(
    (p) => p.tab.toLowerCase() === lower || p.liveTab.toLowerCase() === lower,
  );
  if (exact) return exact;

  const prefix = projects.find((p) => {
    const base = p.tab.toLowerCase();
    return lower === base || lower.startsWith(`${base} `) || lower.startsWith(`${base}-`);
  });
  return prefix ?? null;
}

export function isProjectTabOpen(project: ProjectState, liveTabs: string[]): boolean {
  const canonical = (project.liveTab ?? project.tab).toLowerCase();
  const projectKey = project.tab.toLowerCase();
  return liveTabs.some((tab) => {
    const open = tab.toLowerCase();
    return (
      open === canonical ||
      open === projectKey ||
      open.startsWith(`${canonical} `) ||
      open.startsWith(`${canonical}-`) ||
      open.startsWith(`${projectKey} `) ||
      open.startsWith(`${projectKey}-`)
    );
  });
}

export function getTabActivityText(
  project: ProjectState | null,
  display: ProjectDisplayState | null,
): string | null {
  // Returns the short activity string shown next to each workspace row, or
  // null when there is nothing to say beyond the state badge — every
  // non-running row used to repeat the badge text ("Awaiting input |
  // Awaiting input") which read as a rendering glitch.
  //
  // Critical rule (2026-05-31): NEVER paste raw handoff content (the agent's
  // own done/next/status notes) into the default row text. These were leaking
  // into the UI as "Saved handoff: ..." prefixes that exposed internal agent
  // bookkeeping to the user. Activity text is the running prompt's label
  // only; handoff content belongs in a per-project expand/tooltip.
  if (!project) return "Tab open — not registered in fleet";
  if (display?.isRunning && project.currentPrompt?.label) {
    return project.currentPrompt.label;
  }
  // Idle: surface the last activity event (dispatch or run outcome).
  const summary = latestActivitySummary(project.recentActivity ?? []);
  const lastAt = project.recentActivity?.[0]?.at;
  if (summary && lastAt) {
    return `${summary} · ${timeAgo(new Date(lastAt).getTime())}`;
  }
  return null;
}

export function buildLiveTabRows(
  liveTabs: string[],
  projects: ProjectState[],
  nowS: number,
  syncStale = false,
): LiveTabRow[] {
  const uniqueTabs = [...new Set(liveTabs.map((t) => t.trim()).filter(Boolean))];
  return (
    uniqueTabs
      // 2026-05-31: skip live tabs that don't map to any registered project.
      // The user surfaced "Tab #1 Unlinked" as visible noise — scratch tabs
      // (from the era when the runner listed every terminal tab) that had
      // nothing to do with the fleet. The Loki UI is for fleet ops, not
      // a generic tab list. To re-expose unregistered tabs later, gate this on
      // a "show all tabs" toggle in the UI.
      .map((tabName) => ({ tabName, project: findProjectForOpenTab(tabName, projects) }))
      .filter(
        (entry): entry is { tabName: string; project: ProjectState } => entry.project !== null,
      )
      .map(({ tabName, project }) => {
        const display = getProjectDisplayState(project, uniqueTabs, nowS, false, true, syncStale);
        // When a prompt is running but the /proc scan hasn't caught the agent
        // process yet (the brief launch window), prefer the dispatched adapter
        // ("Claude", "Cursor", …) over a bare generic "Agent" — but only when
        // it's a real adapter, not the "unknown" placeholder a raw tab-inject
        // writes (which would render a worse "Unknown").
        const dispatched = project.currentPrompt?.adapter;
        const dispatchedLabel =
          dispatched && dispatched !== "unknown" ? labelForProcessOrAdapter(dispatched) : null;
        const agentLabel = project.activeAgents.length
          ? formatAgentRuntimeLabel(project, tabName)
          : display.isRunning
            ? (dispatchedLabel ?? "Agent")
            : inferAgentLabelFromTabName(tabName);
        return {
          tabName,
          project,
          agentLabel: agentLabel || null,
          stateKey: display.stateKey,
          stateLabel: display.stateLabel,
          stateTagClass: display.stateTagClass,
          activity: getTabActivityText(project, display),
          isWorking: display.isRunning,
          isWaiting:
            display.isReady || display.isOrchestrationReady || display.tone === "session-open",
          registered: true,
        } satisfies LiveTabRow;
      })
      .sort((a, b) => {
        const rankDelta = LIVE_TAB_RANK[a.stateLabel] - LIVE_TAB_RANK[b.stateLabel];
        if (rankDelta !== 0) return rankDelta;
        return a.tabName.localeCompare(b.tabName);
      })
  );
}

export type ControlPageState = {
  dashboard: ControlDashboardState;
  attention: AttentionItem[];
};

function attentionScore(project: ProjectState): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  const sessionHealth = project.session?.health?.toLowerCase() ?? "";
  if (sessionHealth === "critical") {
    score += 4;
    reasons.push("critical");
  } else if (sessionHealth.includes("attention")) {
    score += 2;
    reasons.push("needs attention");
  }

  const runHealth = project.latestOrchestrationRun?.summary?.health?.toLowerCase() ?? "";
  if (runHealth === "critical" && score < 4) {
    score += 3;
    reasons.push("last run: critical");
  } else if (runHealth.includes("attention") && score < 2) {
    score += 2;
    reasons.push("last run: needs attention");
  }

  return { score, reason: reasons[0] ?? "" };
}

/** "agent" is a legacy process basename for Cursor — see scripts/_agents.sh
 *  AGENT_PROCESS_NAMES[cursor]="agent". Only relevant when reading active
 *  process names, never as a UI id. */
const PROCESS_NAME_ALIASES: Record<string, AnyAgentId> = {
  agent: "cursor",
};

function labelForProcessOrAdapter(name: string): string {
  const id = (PROCESS_NAME_ALIASES[name] ?? name) as AnyAgentId;
  return AGENT_LABELS[id] ?? name[0]?.toUpperCase() + name.slice(1);
}

export function formatAgentRuntimeLabel(project: ProjectState, liveTab?: string): string {
  // Prefer live process detection
  let names = project.activeAgents.length ? project.activeAgents : [];
  // Then current prompt adapter (what was last dispatched)
  if (!names.length && project.currentPrompt?.adapter) {
    names = [project.currentPrompt.adapter];
  }
  // Strong fallback: infer from the actual live tab name the project is using right now.
  // This fixes the case where the user is actively in the tab running Grok (or another agent)
  // but activeAgents / currentPrompt haven't updated yet or the process scan missed it.
  if (!names.length && liveTab) {
    const inferred = inferAdapterFromTabName(liveTab);
    if (inferred) names = [inferred];
  }
  return names.map(labelForProcessOrAdapter).join(", ");
}

export function inferAgentLabelFromTabName(tabName: string): string | null {
  const id = inferAdapterFromTabName(tabName);
  return id ? (AGENT_LABELS[id] ?? null) : null;
}

/** The evidence line for each way a project can be "Working". Keyed by
 *  ProjectDisplayState["runningEvidence"] so a new running signal cannot be
 *  added without stating what it actually observed. */
const RUNNING_EVIDENCE_LABEL: Record<
  NonNullable<ProjectDisplayState["runningEvidence"]>,
  string
> = {
  process: "Live agent process detected",
  "live-turn": "Agent reported a turn in progress",
  "run-output": "Run output still arriving from the builder",
  "dispatched-prompt": "Dispatched prompt still tracked, no agent process seen",
};

export function getProjectDisplayState(
  project: ProjectState,
  liveTabs: string[],
  nowS: number,
  dismissed = false,
  runtimeStateKnown = true,
  syncStale = false,
): ProjectDisplayState {
  if (!runtimeStateKnown) {
    return {
      isClosed: false,
      isClosing: false,
      isReady: false,
      isOrchestrationReady: false,
      isBeaconActive: false,
      isRunning: false,
      runningEvidence: null,
      isAgentWorking: false,
      isSessionOpen: false,
      isActive: false,
      showRunningBanner: false,
      showLatestOrchestration: false,
      tabOpen: false,
      tone: "offline",
      stateKey: "offline",
      stateLabel: STATE_DEFINITIONS.offline.label,
      stateTagClass: STATE_DEFINITIONS.offline.tagClass,
    };
  }
  // Track active work from a fresh current-prompt sentinel. Do not require
  // agentRunning — cloud runner may hold a Loki-dispatched prompt while
  // /proc scan misses Cursor Agent or IDE-side Composer activity.
  const stale = isCurrentPromptStale(project, nowS);
  const currentPrompt = project.currentPrompt && !stale ? project.currentPrompt : null;
  const promptRunning = Boolean(currentPrompt);
  const isSessionOpen = project.agentRunning;
  // An agent that told us it started a turn and never told us it finished is
  // working — full stop. This outranks every inference below (tab names, /proc
  // scans, sentinel files) because it is the agent's own report rather than a
  // guess about the machine it runs on, and it is the ONLY signal that sees a
  // session started outside Loki — which is how the fleet card read
  // "0 working · 21 idle" with eight agents mid-task. Staleness is bounded
  // server-side by OPEN_TURN_TTL_MS; a second time check here would be a
  // second definition of "too old" for the two to disagree about.
  const liveTurnRunning = (project.liveAgentTurns?.count ?? 0) > 0;
  const verifiedRunRunning = project.verifiedRunActive;

  const isClosed =
    !dismissed && !project.agentRunning && withinWindow(project.closedAt, nowS, CLOSED_WINDOW_S);
  const isClosing =
    !dismissed && !isClosed && withinWindow(project.closingAt, nowS, CLOSING_WINDOW_S);
  // Ready when the stop hook has fired recently AND no prompt is actively running.
  // We do NOT require !agentRunning because the claude process stays alive between
  // turns — using it would permanently suppress the ready state for all active sessions.
  // `!liveTurnRunning`: readyAt says "the agent finished a turn recently". If it
  // has since STARTED another one, it is working again — without this the card
  // would sit on "Ready" through the whole next turn, and the project would be
  // counted in the awaiting-you bucket while an agent was actively editing it.
  const isReady =
    !dismissed &&
    !isClosed &&
    !isClosing &&
    !currentPrompt &&
    !liveTurnRunning &&
    !verifiedRunRunning &&
    withinWindow(project.readyAt, nowS, READY_WINDOW_S);

  const isBeaconActive = withinWindow(project.lockAt, nowS, READY_WINDOW_S);

  const latestFinishedAtS = project.latestOrchestrationRun?.finishedAt
    ? Math.floor(new Date(project.latestOrchestrationRun.finishedAt).getTime() / 1000)
    : null;
  const isOrchestrationReady =
    !dismissed &&
    !isReady &&
    !isClosed &&
    !isClosing &&
    !currentPrompt &&
    !liveTurnRunning &&
    !verifiedRunRunning &&
    project.latestOrchestrationRun?.state === ORCH_STATE.DONE &&
    withinWindow(latestFinishedAtS, nowS, READY_WINDOW_S);

  // One derivation for "running" AND for why, so the badge and the evidence
  // line cannot drift apart. Order is weakest-claim-last; a branch is only
  // taken when its own signal is present, so the label never over-claims.
  //
  // `agentRunning` cannot stand in for "a process exists": the control route
  // ORs verifiedRunActive into it, so a verified run alone sets it. Requiring
  // !verifiedRunRunning here means a concurrent process + run is reported as
  // "run-output" — under-claiming, which is the safe direction.
  const processObserved = project.agentRunning && !verifiedRunRunning;
  const runningEvidence: ProjectDisplayState["runningEvidence"] =
    promptRunning && processObserved
      ? "process"
      : liveTurnRunning
        ? "live-turn"
        : verifiedRunRunning
          ? "run-output"
          : promptRunning
            ? "dispatched-prompt"
            : null;
  const isRunning = runningEvidence !== null;
  // Show the running banner whenever a prompt is actively tracked — don't require
  // isRunning because the process may not yet appear in /proc on the current tick.
  const showRunningBanner = !isClosing && !isReady && Boolean(currentPrompt);
  const showLatestOrchestration =
    Boolean(project.latestOrchestrationRun) &&
    project.latestOrchestrationRun?.state !== ORCH_STATE.ERROR &&
    !isRunning &&
    !showRunningBanner &&
    !isReady &&
    !isOrchestrationReady &&
    !isClosing &&
    !isClosed;
  const tabOpen = isProjectTabOpen(project, liveTabs);
  const isActive =
    isRunning ||
    isOrchestrationReady ||
    withinWindow(project.readyAt, nowS, ACTIVE_WINDOW_S) ||
    withinWindow(project.closingAt, nowS, ACTIVE_WINDOW_S) ||
    withinWindow(project.closedAt, nowS, ACTIVE_WINDOW_S) ||
    isSessionOpen ||
    currentPrompt !== null;

  const tone: ProjectDisplayState["tone"] = isClosed
    ? "closed"
    : isClosing
      ? "closing"
      : isReady
        ? "ready"
        : isOrchestrationReady
          ? "orchestration-ready"
          : isRunning
            ? "running"
            : isSessionOpen
              ? "session-open"
              : "idle";

  // Labels and tag classes used to be a pair of Records here. Now they come
  // from STATE_DEFINITIONS in lib/control-states — adding a state requires
  // exactly one literal edit, and the badge + dot + chip + tooltip + agent
  // prompt context cannot disagree.

  // Map the legacy 8-value tone enum onto the SSOT 9-value ProjectStateKey.
  // The "idle + tabOpen" special case becomes its own first-class key, so the
  // badge, the dot color, and the agent prompt context all read the same.
  const TONE_TO_STATE_KEY: Record<ProjectDisplayState["tone"], ProjectStateKey> = {
    offline: "offline",
    running: "working",
    "session-open": "open_idle",
    ready: "ready",
    "orchestration-ready": "orchestration_ready",
    closing: "closing",
    closed: "completed",
    idle: "not_running",
  };
  // "Not running" is a claim the recorded facts can contradict: sessions run
  // in unnamed kitty tabs Loki can't observe, but their hook-captured
  // dispatches and orchestration runs still land here. A project whose last
  // dispatch/run is recent gets "Active recently" instead of asserting death.
  const lastDispatchMs = project.recentActivity?.[0]?.at
    ? Date.parse(project.recentActivity[0].at)
    : 0;
  const lastRunFinishMs = project.latestOrchestrationRun?.finishedAt
    ? Date.parse(project.latestOrchestrationRun.finishedAt)
    : 0;
  const recentlyActive =
    nowS * 1000 - Math.max(lastDispatchMs, lastRunFinishMs) < RECENTLY_ACTIVE_WINDOW_MS;
  const stateKey: ProjectStateKey =
    tone === "idle" && tabOpen && !isSessionOpen
      ? "tab_open"
      : tone === "idle" && recentlyActive
        ? "recently_active"
        : TONE_TO_STATE_KEY[tone];

  // Runner sync is stale (cloud path, last push older than the offline
  // threshold): every runtime flag above was derived from that stale push and
  // can no longer be asserted as live. Collapse to the honest "offline" state —
  // no "Working" badge, no ticking running-banner, and not counted as working /
  // awaiting / idle — so the board stops claiming an agent is busy when the
  // runner may have died hours ago. `tabOpen` is preserved so the evidence
  // subtitle (buildProjectOperationsSnapshot) can still say "Last sync <ago>".
  // Never fires on the local runtime: runtimeAvailable ⇒ runnerSyncStale is
  // always false, so getProjectDisplayState is called with syncStale = false.
  if (syncStale) {
    return {
      isClosed: false,
      isClosing: false,
      isReady: false,
      isOrchestrationReady: false,
      isBeaconActive: false,
      isRunning: false,
      runningEvidence: null,
      isAgentWorking: false,
      isSessionOpen: false,
      isActive: false,
      showRunningBanner: false,
      showLatestOrchestration: false,
      tabOpen,
      tone: "offline",
      stateKey: "offline",
      stateLabel: STATE_DEFINITIONS.offline.label,
      stateTagClass: STATE_DEFINITIONS.offline.tagClass,
    };
  }

  return {
    isClosed,
    isClosing,
    isReady,
    isOrchestrationReady,
    isBeaconActive,
    isRunning,
    runningEvidence,
    isAgentWorking: isRunning,
    isSessionOpen,
    isActive,
    showRunningBanner,
    showLatestOrchestration,
    tabOpen,
    tone,
    stateKey,
    stateLabel: STATE_DEFINITIONS[stateKey].label,
    stateTagClass: STATE_DEFINITIONS[stateKey].tagClass,
  };
}

export function buildProjectOperationsSnapshot(
  project: ProjectState,
  liveTabs: string[],
  nowS: number,
  runtimeStateKnown = true,
  syncCtx: RuntimeSyncContext = {},
): ProjectOperationsSnapshot {
  const { syncStale = false, lastSyncedAt = null } = syncCtx;
  const display = getProjectDisplayState(
    project,
    liveTabs,
    nowS,
    false,
    runtimeStateKnown,
    syncStale,
  );
  // Phase IS stateKey now — the SSOT enum is the only enum. Operations
  // snapshot just exposes the same key under the legacy `phase` field for
  // callers mid-migration. Once those callers move, this whole block
  // collapses to `const phase = display.stateKey;`.
  const phase: ControlPhase = display.stateKey;
  const attention = attentionScore(project);
  const handoffAt = project.session?.mtime ?? null;
  const contextSummary =
    display.isRunning && project.currentPrompt?.label
      ? project.currentPrompt.label
      : project.session?.next?.trim()
        ? project.session.next.trim()
        : project.session?.done?.trim()
          ? project.session.done.trim()
          : null;
  // States that assert a live observation on the agent host. When the runner
  // sync is stale these claims come from the last push and may no longer be
  // true — the evidence line must say when they were observed, not pair the
  // claim with an unrelated handoff-file timestamp (pre-fix: "Awaiting input
  // 1w ago" — badge from a 34h-old push, timestamp from a week-old handoff,
  // reading as "the agent sat at the prompt for a week").
  const claimsLiveObservation =
    display.isRunning ||
    display.isReady ||
    display.isOrchestrationReady ||
    display.isSessionOpen ||
    display.tabOpen;
  const liveObserved = runtimeStateKnown && !syncStale && claimsLiveObservation;
  const latestActivity = project.recentActivity?.[0];
  const latestActivityAgeS = latestActivity?.at
    ? nowS - Math.floor(new Date(latestActivity.at).getTime() / 1000)
    : null;
  const recentDispatchSuffix =
    latestActivity &&
    latestActivity.kind === "dispatch" &&
    latestActivityAgeS !== null &&
    latestActivityAgeS >= 0 &&
    latestActivityAgeS < STALE_PROMPT_S
      ? `Last dispatch ${timeAgo(new Date(latestActivity.at).getTime())}`
      : null;

  // Each label names the signal that actually fired. "Live agent process
  // detected" is reserved for a real /proc observation; the other three states
  // are honest about being a report, a stream, or a tracked sentinel rather
  // than borrowing the process claim (2026-09-17: Control asserted a detected
  // process for a project whose API reported none — see runningEvidence).
  // Evidence labels are the LONG-form descriptions shown as subtitles next
  // to the badge. They INTENTIONALLY add detail the badge can't fit (e.g.,
  // "Agent signaled ready on connected computer" vs the badge's "Ready for
  // next step"). A quiet process is not proof that it asked the user a
  // question, so open_idle uses the same neutral label as its badge.
  const liveEvidenceLabel = display.isRunning
    ? RUNNING_EVIDENCE_LABEL[display.runningEvidence ?? "dispatched-prompt"]
    : display.isReady
      ? "Agent signaled ready on connected computer"
      : display.isOrchestrationReady
        ? "Last run completed"
        : display.isSessionOpen
          ? "Agent idle"
          : display.tabOpen
            ? // The state chip on this card ALREADY reads "Tab open" — it is the
              // label control-states.ts gives this phase. Saying "Workspace tab
              // open" underneath repeated it in different words and told the
              // reader nothing new, on every card in that state.
              //
              // The evidence line exists to name WHAT WAS OBSERVED that
              // justifies the state: "Live agent process detected", "Agent
              // signaled ready on connected computer", "Last run completed".
              // When the only thing to say is the label again, the honest
              // amount to say is nothing — unless there is a real observation
              // to add, which is what the dispatch suffix carries.
              (recentDispatchSuffix ?? "")
            : "No recent activity";

  // "Saved agent context" was the prior wording — flagged in browser dogfood
  // 2026-05-31 as opaque jargon that reads like an internal-data label (the
  // user wondered whether their notes were being exposed). Replaced with
  // "Idle" which describes the OBSERVABLE state for the human, not the
  // internal-data state for the system. The recency is shown separately by
  // the row's timestamp column, so the prefix doesn't need to duplicate it.
  // Historical evidence: name the FRESHEST recorded signal, not a blanket
  // "Idle". Agents the user runs outside Fleet Runner (their own terminal,
  // kitty, multi-project shells) are invisible to live process detection —
  // but runs and dispatches still land in Loki. "orangecat — Idle today" while its
  // last run finished 40 minutes ago (2026-08-13) read as a dead project;
  // "Last run 40m ago" is what actually happened.
  const lastRunAt = project.latestOrchestrationRun?.finishedAt
    ? Date.parse(project.latestOrchestrationRun.finishedAt)
    : 0;
  const lastDispatchAt = latestActivity?.at ? Date.parse(latestActivity.at) : 0;
  const historicalAt = Math.max(handoffAt ?? 0, lastRunAt, lastDispatchAt);
  const historicalLabel =
    historicalAt === 0
      ? "No recent activity"
      : historicalAt === lastRunAt && lastRunAt > 0
        ? "Last run"
        : historicalAt === lastDispatchAt && lastDispatchAt > 0
          ? "Last dispatch"
          : // Name the SIGNAL, like the two branches above. "Idle" described a
            // state while its siblings named their evidence, so the same row slot
            // read as two different kinds of fact ("Idle 1mo ago" vs "Last run
            // 1w ago") — the handoff file is what this timestamp comes from.
            "Last handoff";
  const evidenceLabel = !runtimeStateKnown
    ? "Live status unavailable"
    : syncStale && claimsLiveObservation
      ? staleSyncLabel(lastSyncedAt)
      : liveObserved
        ? liveEvidenceLabel
        : historicalLabel;

  return {
    project,
    phase,
    display,
    evidenceLabel,
    // A stale live-claim's only honest timestamp is the sync time (already in
    // the label) — attaching handoffAt here is what produced "Awaiting input
    // 1w ago". Historical rows carry the timestamp of the signal the label
    // names (run finish / dispatch / handoff), not always the handoff.
    evidenceAt:
      liveObserved || (syncStale && claimsLiveObservation)
        ? null
        : historicalAt > 0
          ? historicalAt
          : null,
    evidenceKind: !runtimeStateKnown
      ? "unknown"
      : syncStale
        ? "historical"
        : liveObserved
          ? "live"
          : "historical",
    contextSummary,
    attentionReason: attention.score > 0 ? attention.reason : null,
  };
}

export function buildProjectOperationsSnapshots(
  projects: ProjectState[],
  liveTabs: string[],
  nowS: number,
  runtimeStateKnown = true,
  syncCtx: RuntimeSyncContext = {},
): ProjectOperationsSnapshot[] {
  const { syncStale = false } = syncCtx;
  return projects
    .map((project) =>
      buildProjectOperationsSnapshot(project, liveTabs, nowS, runtimeStateKnown, syncCtx),
    )
    .sort((a, b) =>
      compareProjects(a.project, b.project, liveTabs, nowS, runtimeStateKnown, syncStale),
    );
}

function compareProjects(
  a: ProjectState,
  b: ProjectState,
  liveTabs: string[],
  nowS: number,
  runtimeStateKnown: boolean,
  syncStale = false,
): number {
  const aState = getProjectDisplayState(a, liveTabs, nowS, false, runtimeStateKnown, syncStale);
  const bState = getProjectDisplayState(b, liveTabs, nowS, false, runtimeStateKnown, syncStale);

  const rank = (state: ProjectDisplayState): number => {
    if (state.isReady || state.isOrchestrationReady) return 0;
    if (state.isRunning) return 1;
    if (state.isClosing) return 2;
    if (state.isSessionOpen) return 3;
    if (state.isClosed) return 4;
    return 5;
  };

  const rankDelta = rank(aState) - rank(bState);
  if (rankDelta !== 0) return rankDelta;

  const aActiveGit = (a.git?.todayCount ?? 0) > 0 ? 0 : 1;
  const bActiveGit = (b.git?.todayCount ?? 0) > 0 ? 0 : 1;
  return aActiveGit - bActiveGit;
}

export function buildControlPageState(
  data: ControlData,
  nowS: number,
  runtimeStateKnown = true,
  syncStale = false,
): ControlPageState {
  // Bucket every project by the SAME counterCategory the rail
  // (ProjectOperationsView) reads off each row's stateKey, so the header chips
  // and the rail counts come from one SSOT and can never disagree. Previously
  // the header's third number was openTabCount — every project with an agent
  // terminal open, a SUPERSET that double-counted the working/awaiting projects —
  // while the rail showed the mutually-exclusive idle bucket: the same screen
  // had "open" meaning two different numbers. Now both read working/waiting/
  // idle off counterCategory. syncStale collapses stale projects to the
  // "offline" category, so they drop out of all three live counts.
  const categories = data.projects.map(
    (project) =>
      STATE_DEFINITIONS[
        getProjectDisplayState(project, data.liveTabs, nowS, false, runtimeStateKnown, syncStale)
          .stateKey
      ].counterCategory,
  );
  // Not "how many are idle" but "we cannot know yet" — see countsKnown.
  const countsKnown = runtimeStateKnown;
  const runningCount = categories.filter((c) => c === "working").length;
  const waitingCount = categories.filter((c) => c === "waiting").length;
  const idleCount = categories.filter((c) => c === "idle").length;
  const openTabCount = data.projects.filter((project) =>
    isProjectTabOpen(project, data.liveTabs),
  ).length;
  const controlProjectCount = data.inventory.controlProjectCount ?? 0;
  const commitsToday = data.projects.reduce((sum, p) => sum + (p.git?.todayCount ?? 0), 0);

  const attention = data.projects
    .map((project) => ({ project, ...attentionScore(project) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  return {
    attention,
    dashboard: {
      countsKnown,
      runningCount,
      waitingCount,
      controlProjectCount,
      openTabCount,
      idleCount,

      commitsToday,
    },
  };
}
