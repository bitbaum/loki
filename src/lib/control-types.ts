import type { RecentCustomPrompt } from "@/db/queries/prompt-history";
import type { OrchestrationTaskSummary } from "@/lib/orchestration";
import type { OrchestrationOutcome } from "@/db/schema/orchestration-runs";
import type { RepoWorkEvidence } from "@/lib/repo-evidence";

export type ProjectProfile = {
  description: string;
  status: string;
  maturity: string;
  stack: string;
  url: string;
  mission: string;
  attrs: Record<string, string>;
};

export type CurrentPrompt = {
  key: string;
  label: string;
  startedAt: number;
  source?: "inject" | "runner" | "hook" | "unknown";
  adapter?: string;
};

export type SessionState = {
  /** Agent's self-reported lifecycle state: 'ready' = done, auto-inject may
   *  proceed; 'working' = mid-task, suppress auto-inject; 'blocked' = agent
   *  has handed control back to the user (loop must not fire). Missing/
   *  undefined is treated as NOT ready by the auto-inject gates (conservative).
   *  Optional so legacy construction sites that don't yet plumb session_status
   *  can omit it during the back-compat window — they'll just suppress
   *  auto-fire which matches the user's stated intent. */
  status?: string;
  done: string;
  next: string;
  tests: string;
  todos: string;
  health: string;
  /** The rest of the evidence the handoff contract asks for. Optional only for
   *  back-compat with handoffs written before a runner shipped them — NOT
   *  optional in intent: the DoD judge is explicitly prompted to look for
   *  typecheck, lint and commit evidence, so a path that silently omits them
   *  makes a fully-verified run indistinguishable from an unverified one.
   *  That was the state of the world until 2026-08-06 (0 of 56 runs carried
   *  any of the three). Whoever adds a field to the handoff contract must
   *  carry it through here too — `scripts/test/handoff-evidence.ts` fails if
   *  an evidence field goes missing between the handoff and the judge. */
  tsc?: string;
  lint?: string;
  commit?: string;
  /** Why the agent is blocked, when status: 'blocked' OR the agent's last
   *  turn was a no-op pending user input. SSOT for the "Needs input" chip.
   *  Sourced from `block-reason:` line in session.md. Optional because
   *  pre-2026-06-08 sessions don't emit it — deriveLoopState falls back to
   *  content-sniffing health/status for those. */
  blockReason?: string;
  /** Number of consecutive no-op turns the autopilot loop has fired. The
   *  agent increments this each turn it picks no work. Sourced from
   *  `no-op-count:` line in session.md. Pure metric — no business logic
   *  attached, the bash guard skips when this is >= 1. */
  noOpCount?: number;
  mtime: number; // epoch milliseconds
};

export type GitState = {
  branch: string;
  lastMsg: string;
  lastWhen: string;
  dirty: boolean;
  dirtyCount: number;
  todayCount: number;
  /** Commits the remote is ahead of local HEAD (0 = in sync, requires fetch) */
  behindRemote: number;
  /** Last 5 commits formatted as "HASH DATE: MESSAGE" */
  recentCommits: string[];
};

/** Open agent turns for one project — see ProjectState.liveAgentTurns. */
export type LiveAgentTurns = {
  /** How many distinct agent sessions have an open turn on this project. */
  count: number;
  /** ISO start of the OLDEST open turn — "working 40m" should describe the
   *  longest-running turn, not whichever session pinged most recently. */
  startedAt: string;
  /** The working directories involved (worktrees included), so the UI can say
   *  WHICH checkout is busy when several are. */
  cwds: string[];
};

export type ProjectState = {
  id: string | null;
  projectId: string | null;
  readonly?: boolean;
  tab: string;
  workspaceId?: string | null;
  liveTab: string;
  dir: string;
  agentPref: string | null;
  modelPref: string | null;
  /** Stored builder tier (`user_projects.builder_pref`). Null = cloud. */
  builderPref: string | null;
  session: SessionState | null;
  git: GitState | null;
  sessionLifecycleSignals: boolean;
  agentRunning: boolean;
  activeAgents: string[];
  profile: ProjectProfile | null;
  currentPrompt: CurrentPrompt | null;
  readyAt: number | null;
  lockAt: number | null;
  closingAt: number | null;
  closedAt: number | null;
  recentCustomPrompts: RecentCustomPrompt[];
  /** Unified timeline — dispatches, run outcomes, lifecycle signals (SSOT: activity.ts). */
  recentActivity: import("@/db/queries/activity").ProjectActivityEvent[];
  /** Per-tab queue + autopilot toggle, streamed via /api/control/stream so
   *  per-card hooks read from props instead of polling /api/beacon/queue/*. */
  promptQueue?: string[];
  promptQueueRevision?: number;
  autoContinueEnabled?: boolean;
  /** Last 5 outcomes for this project, newest first. Powers the streak chip + dispatch reasoner. */
  recentOutcomes: OrchestrationOutcome[];
  /**
   * Agent turns open RIGHT NOW, as reported by the agents themselves through
   * the Claude UserPromptSubmit → Stop hook pair (table: agent_sessions).
   *
   * This is the only "working" signal that does not depend on Loki having
   * dispatched the run or on the runner recognising a zellij tab name — which
   * is why the fleet card could read "0 working" with eight agents mid-task.
   * `null` means no open turn; it does NOT mean nothing is running, because a
   * machine without the hooks installed reports nothing at all.
   *
   * REQUIRED, not optional: an optional field lets a route that forgets to
   * select it compile clean and silently render "idle" forever — the exact
   * class that hid this bug for months.
   */
  liveAgentTurns: LiveAgentTurns | null;
  /** Per-project autopilot mode override. NULL = inherit the user-level
   *  beacon_settings.auto_inject_mode. Set by the per-project pause/resume
   *  toggle on ProjectCard. Read by /api/control/dispatch (v0.7+). */
  autoInjectModeOverride: import("@/config/beacon").AutoInjectMode | null;
  latestOrchestrationRun: {
    adapter: string;
    intent: string;
    state: string;
    startedAt: string;
    finishedAt: string | null;
    summary: OrchestrationTaskSummary | null;
    // Token accounting (runner-reported, box-priced). Null until the first
    // usage report lands — older runs stay null forever.
    tokensIn: number | null;
    tokensOut: number | null;
    tokensCacheRead: number | null;
    costUsd: number | null;
    payload: {
      resultText?: string;
      /** A genuine failure. Rendered in the error style. */
      error?: string;
      /** How a run that did NOT fail ended — a reaper correction, say.
       *  Rendered neutrally: a `partial` run is a success, and styling its
       *  explanation as an error made a corrected run look worse than an
       *  uncorrected one. */
      note?: string;
      /** Repo work found during the run window, which is WHY a timeout was
       *  corrected to partial. Structured, so the card can link to it instead
       *  of saying "(see evidence)" and leaving the reader to guess where. */
      evidence?: RepoWorkEvidence;
      durationMs?: number;
      model?: string;
    } | null;
  } | null;
};

export type FailedCommand = {
  id: string;
  tab: string;
  type: string;
  error: string;
  executedAt: string;
  /** True when result.ok was reported true but verified was false — the
   *  keystrokes landed but the agent didn't react within the verification
   *  window. The user should re-launch the agent or check zellij. */
  unverified?: boolean;
};

export type ControlData = {
  agentRegistry: import("@/lib/agent-catalog").AgentCatalog;
  agentConfig: { agent: import("@/lib/agent-catalog").SwitchableAgent; model: string };
  /**
   * The operator's provider ranking (user_preferences.agent_order), or null
   * when they have never stated one — null means "use the fleet default",
   * which is a different thing from an empty preference.
   *
   * Lives on the snapshot rather than being fetched per card so Control's
   * capacity banner resolves the same next provider the Feedback row and the
   * Terminal rail do. They disagreed before this field existed.
   */
  agentOrder: string[] | null;
  orchestration: {
    manualPromptInjection: boolean;
    autonomousPromptLoop: boolean;
    sessionLifecycleSignals: boolean;
  };
  inventory: {
    source: "user_projects" | "projects_conf_fallback";
    trackedProjectCount: number;
    controlProjectCount: number;
    linkedDirectoryCount: number;
  };
  projects: ProjectState[];
  prompts: import("@/lib/agent-config").PromptMeta[];
  liveTabs: string[];
  recentActivity: import("@/db/queries/prompt-history").ActivityItem[];
  runtimeAvailable: boolean;
  /** Latest RUNTIME push from any of this user's builders. Runtime pushes
   *  only — never bumped by web-originated writes or teammates' runners. */
  runnerLastPushedAt: string | null;
  runnerVersion: string | null;
  /** Per-channel builder versions — two builders can be online at once, so a
   *  single version string cannot describe the fleet. null on local runtime. */
  builderVersions: { cloud: string | null; local: string | null } | null;
  /** Cloud vs local builder SSE channels (bridge). null on local runtime host. */
  builderPresence: { cloud: boolean; local: boolean; any: boolean } | null;
  /** Execution health: a runner can push snapshots while its command loop is
   *  hung, queuing dispatches forever. null when runtime is local. */
  runnerExecutionStall: {
    stalled: boolean;
    stalledCount: number;
    oldestSeconds: number;
    tabs: string[];
  } | null;
  failedCommands: FailedCommand[];
};
