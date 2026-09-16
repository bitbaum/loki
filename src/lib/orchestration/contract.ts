import type { RuntimeLifecycleFacts, RuntimeEventCandidate } from "./state";
import type { OpenRun, RunClosePatch } from "./close-from-session";
import type { SessionState } from "@/lib/control-types";

export const ORCHESTRATION_STATES = [
  "idle",
  "running",
  "waiting",
  "done",
  "closing",
  "closed",
  "error",
] as const;

export type OrchestrationState = (typeof ORCHESTRATION_STATES)[number];

/** Keyed access to run states — the SSOT for every comparison and write.
 *  Use ORCH_STATE.RUNNING instead of the raw "running" literal so the
 *  compiler catches typos and refactors stay one-file changes. */
export const ORCH_STATE = {
  IDLE: "idle",
  RUNNING: "running",
  WAITING: "waiting",
  DONE: "done",
  CLOSING: "closing",
  CLOSED: "closed",
  ERROR: "error",
} as const satisfies Record<string, OrchestrationState>;

/** Canonical run outcome values — SSOT for the column type, the finish-route
 *  validator (ORCHESTRATION_OUTCOMES tuple), and outcome inference. Lives here
 *  (not in the drizzle schema) because client components value-import these —
 *  a schema value import drags drizzle pg-core into the browser bundle. The
 *  schema module re-exports them for server callers. */
export const ORCHESTRATION_OUTCOME = {
  SUCCESS: "success",
  PARTIAL: "partial",
  ERROR: "error",
  HANG: "hang",
  USER_ABORT: "user_abort",
  TIMEOUT: "timeout",
  /** The prompt was injected, but the agent was never observed starting work
   *  — the runner acked `verified: false` after its retries. Deliberately NOT
   *  called "undelivered": that name is already taken by the stronger signal
   *  (a runner NACK, `ok: false` → closeRunUndelivered), and the evidence here
   *  does not reach it. The runner's own ack says "injected"; what it could not
   *  establish is whether the agent picked it up. Both readings stay possible
   *  — the pane may have been idle with the agent gone, or the agent may have
   *  been wedged — so the name states the observation, not a conclusion.
   *
   *  Distinct from TIMEOUT, which claims an agent ran and ran out of time.
   *  Conflating them billed infrastructure faults to projects: 29 of 157
   *  timeouts measured 2026-08-26, and surf-your-life climbed to the ladder's
   *  `human` rung with ten of them behind it. */
  UNCONFIRMED: "unconfirmed",
} as const;
export const ORCHESTRATION_OUTCOMES = [
  ORCHESTRATION_OUTCOME.SUCCESS,
  ORCHESTRATION_OUTCOME.PARTIAL,
  ORCHESTRATION_OUTCOME.ERROR,
  ORCHESTRATION_OUTCOME.HANG,
  ORCHESTRATION_OUTCOME.USER_ABORT,
  ORCHESTRATION_OUTCOME.TIMEOUT,
  ORCHESTRATION_OUTCOME.UNCONFIRMED,
] as const;
export type OrchestrationOutcome = (typeof ORCHESTRATION_OUTCOMES)[number];

export const ORCHESTRATION_EVENTS = [
  "task_started",
  "input_requested",
  "task_progressed",
  "task_completed",
  "continue_requested",
  "close_requested",
  "session_closed",
  "task_failed",
  "funding",
] as const;

export type OrchestrationEventType = (typeof ORCHESTRATION_EVENTS)[number];

export const ORCHESTRATION_CAPABILITIES = [
  "launchSession",
  "injectTask",
  "detectRunning",
  "detectWaiting",
  "detectDone",
  "closeSession",
  "autonomousContinue",
  "sessionHandoff",
  // Adapter may be queued for execution in cloud mode (no local runtime).
  "cloudQueueable",
  // Adapter executes by injecting into a live agent terminal (owned PTY).
  "tabInjected",
] as const;

export type OrchestrationCapability = (typeof ORCHESTRATION_CAPABILITIES)[number];

export const ORCHESTRATION_ADAPTER_IDS = ["claude", "codex", "openclaw", "gemini", "grok", "cursor"] as const;
export type AdapterId = (typeof ORCHESTRATION_ADAPTER_IDS)[number];

export type AdapterCapabilities = Record<OrchestrationCapability, boolean>;

export const ORCHESTRATION_TASK_INTENT_IDS = [
  "next_best",
  "test_and_fix",
  "quality",
  "full_audit",
  "product",
  "ux_review",
  "deploy_check",
  "commit_push",
  "close_session",
  "hard_stop",
  "continue",
  "custom",
] as const;
export type OrchestrationTaskIntentId = (typeof ORCHESTRATION_TASK_INTENT_IDS)[number];

export type OrchestrationTaskIntent = {
  id: OrchestrationTaskIntentId;
  name: string;
  objective: string;
  requiresVerification: boolean;
  requiresSessionHandoff: boolean;
};

export type OrchestrationTaskRequest = {
  projectId?: string | null;
  projectKey: string;
  projectPath: string;
  adapter: AdapterId;
  intent: OrchestrationTaskIntentId;
  model?: string;
  customInstructions?: string;
  /** Optional snapshot of the user's prompt queue for this project at
   *  dispatch time. The renderer surfaces these to the agent as "Pending
   *  queue items" so the agent can weigh them against other scanning
   *  candidates. Model-agnostic: the same context lands in every
   *  adapter's prompt body via renderTaskForAdapter. */
  queue?: string[];
  /** The project's brief + active goals (the roadmap), from getProjectContext.
   *  Surfaced to the agent so it judges "highest-impact next step" against the
   *  actual goals instead of picking generic work. Model-agnostic — lands in
   *  every adapter's prompt body via renderTaskForAdapter. */
  projectContext?: string;
};

// `status` is the agent's self-reported lifecycle state for this handoff:
//   ready    — task fully done, auto-inject may proceed
//   working  — agent is mid-task, suppress auto-inject
// Missing/empty defaults to working (conservative — auto-inject only fires
// when the agent explicitly signals it's done with everything). This is
// model-agnostic: any adapter that writes the standard handoff format
// gets the same auto-inject suppression.
export const ORCHESTRATION_TASK_SUMMARY_FIELDS = [
  "status",
  "last-3-same-dir",
  "wip-or-revert-in-last-5",
  "tsc",
  "lint",
  "tests",
  "todos",
  "done",
  "next",
  // 2026-06-19 — the resulting HEAD short SHA (or "none" when the run made no
  // commit). Closes the "did the agent actually ship?" gap: an outcome of
  // "success" with commit:none is a self-reported success that left no trace
  // in git — exactly the untruthful-state failure mode the control loop must
  // surface rather than trust. Optional for back-compat with older summaries.
  "commit",
  // Retained for summaries written before LOOP v2.
  "health",
  // 2026-06-08 — explicit loop-control fields. Added because the OC no-op
  // spiral surfaced that all three consumers (bash guard, React chips, agent)
  // were parsing the same intent ("agent is blocked on user", "21 no-ops")
  // out of free-text done:/health: strings with different rules. These fields
  // are the SSOT; content-sniffs in session-state.ts + the bash guard remain
  // as fallbacks for sessions written before agents started emitting them.
  "block-reason", // "awaiting_user" | "external_dependency" | "manual_pause"
  "no-op-count", // integer, monotonically incremented by the agent on each no-op turn
] as const;
export type OrchestrationTaskSummaryField = (typeof ORCHESTRATION_TASK_SUMMARY_FIELDS)[number];

// LOOP v2 evidence fields are optional for back-compat with persisted summaries
// written before they existed. `health` remains readable during that migration.
export type OrchestrationTaskSummary = {
  done: string;
  next: string;
  tests: string;
  todos: string;
  health: string;
  status?: string;
  "last-3-same-dir"?: string;
  "wip-or-revert-in-last-5"?: string;
  tsc?: string;
  lint?: string;
  commit?: string;
  "block-reason"?: string;
  "no-op-count"?: string;
  /** Cross-model definition-of-done verdict — written by the DoD stop-gate at
   *  close when the project declares a definition_of_done. Records that a
   *  DIFFERENT model lineage judged the worker's own handoff (the verification a
   *  single-agent runtime structurally cannot do — its judge would be itself).
   *  Surfaced in Activity so "done" visibly means a second mind agreed. */
  verification?: {
    judge: string; // the judging model, or EVIDENCE_PRECHECK_ID when decided deterministically
    worker: string; // the adapter that did the work
    met: boolean; // did the handoff evidence the stated Definition of Done?
    gap?: string; // when not met, the single most important thing still required
    /** Stable category for the gap (e.g. `evidence:lint+tsc`), set only by the
     *  deterministic pre-check. Free-text `gap` from the model judge is a
     *  snowflake — prod 2026-08-07 had 48 distinct sentences across 48
     *  rejections, which is precisely why the corpus could not be learned from.
     *  This field is the groupable counterpart: absent means "a model judged
     *  this", present means "a rule did, and here is which rule". */
    gapCode?: string;
  };
};

export type OrchestrationTaskStatus = {
  state: OrchestrationState;
  startedAt?: string;
  updatedAt?: string;
  summary?: OrchestrationTaskSummary;
  detail?: string;
};

export type OrchestrationLifecycleEvent = {
  type: OrchestrationEventType;
  at: string;
  detail?: string;
};

export interface AgentAdapter {
  readonly id: AdapterId;
  readonly label: string;
  readonly capabilities: AdapterCapabilities;

  launchSession?(request: OrchestrationTaskRequest): Promise<void>;
  injectTask(request: OrchestrationTaskRequest): Promise<void>;
  getStatus(request: OrchestrationTaskRequest): Promise<OrchestrationTaskStatus>;
  closeSession?(request: OrchestrationTaskRequest): Promise<void>;

  // --- Seam hooks (vendor-specific signal → neutral product semantics) ---
  // Absent hooks mean "this adapter has no such signal"; callers fall back to
  // the current neutral behavior (no events / no close / identity prompt).

  /** Map this adapter's runtime facts (e.g. /tmp sentinels) to neutral
   *  lifecycle events. */
  collectLifecycleEvents?(runtime: RuntimeLifecycleFacts): RuntimeEventCandidate[];

  /** Decide whether an agent's session handoff closes an open run. */
  closeRunFromSession?(run: OpenRun, session: SessionState): RunClosePatch | null;

  /** Wrap a base prompt with this adapter's session context. */
  enrichPrompt?(base: string, tab: string, projectStateDescription?: string): string;
}

/** The default adapter when none is specified (replaces scattered `?? "claude"`). */
export const DEFAULT_ADAPTER_ID: AdapterId = "claude";

/** The orchestration seam used by control/inject call sites today. Narrower
 *  than the full AgentAdapter so the registry stays honest while injectTask/
 *  getStatus dispatch consolidation is deferred (see openclaw plan). */
export type OrchestrationSeam = Pick<
  AgentAdapter,
  | "id"
  | "label"
  | "capabilities"
  | "collectLifecycleEvents"
  | "closeRunFromSession"
  | "enrichPrompt"
>;

export function createCapabilities(
  overrides: Partial<AdapterCapabilities> = {},
): AdapterCapabilities {
  return {
    launchSession: false,
    injectTask: false,
    detectRunning: false,
    detectWaiting: false,
    detectDone: false,
    closeSession: false,
    autonomousContinue: false,
    sessionHandoff: false,
    cloudQueueable: false,
    tabInjected: false,
    ...overrides,
  };
}
