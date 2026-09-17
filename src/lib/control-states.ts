/**
 * SSOT for project control-surface states.
 *
 * Every consumer of project state (badge, chip, summary counter, live-terminal row,
 * file. Adding or removing a state requires editing exactly one literal — the
 * compiler then forces every Record below to remain exhaustive, so drift is
 * structurally impossible.
 *
 * Truth discipline:
 *  - `label` is what the user sees. Short, honest, action-implying.
 *  - `description` is the one-line WHY (also shipped to agent prompt context),
 *    so the agent reads the same words the human reads. No paraphrasing.
 *  - `problem` is non-null only when the state itself signals "this needs
 *    your attention" — the UI surfaces it as a tooltip + an actionable hint.
 *  - `counterCategory` is what the summary chip reads. Two states pointing at
 *    the same category is allowed (e.g. ready + orchestration_ready both
 *    count as "waiting"); the categories themselves are the SSOT for chip
 *    arithmetic so the row badge and the chip can never disagree.
 *
 * Add a state? You only need to:
 *  1. Append to PROJECT_STATES
 *  2. The compiler will tell you which Records below to fill
 *  3. Add the derivation rule in deriveProjectState() (lib/derive-project-state.ts)
 */

import { EXECUTOR_COPY } from "@/config/executor-copy";
import { SESSION_STATUS } from "@/lib/constants/statuses";

export const PROJECT_STATES = [
  "offline", // Runner has not pushed state — we genuinely don't know.
  "not_running", // No agent process and no tab — nothing exists for this project.
  "recently_active", // No live process visible, but a dispatch/run landed recently.
  "tab_open", // Agent terminal (owned PTY) open, no agent process detected in it.
  "open_idle", // Agent process detected, no recent lifecycle signal — likely at prompt.
  "working", // Agent mid-turn (lock sentinel fresh OR current prompt active).
  "ready", // Stop hook fired recently — agent just handed off.
  "orchestration_ready", // Latest orchestration run completed recently.
  "closing", // Closing hook fired — agent is shutting down.
  "completed", // Closed hook fired — agent finished cleanly.
] as const;

export type ProjectStateKey = (typeof PROJECT_STATES)[number];

/** Buckets the summary chip counts into. Decoupled from state keys so two
 *  states (ready + orchestration_ready) can both count as "waiting" without
 *  the row badge having to say the same word. */
export type ProjectCounterCategory =
  | "working" // chip: "X working"
  | "waiting" // chip: "Y awaiting input" — covers ready + orchestration_ready + open_idle
  | "idle" // chip: "Z idle" — not running, tab-only, completed
  | "offline"; // chip: "W offline"

export type ProjectStateDefinition = {
  /** Badge text. Short, honest, action-implying. */
  label: string;
  /** One-line WHY this state is currently true. Shipped verbatim to agent
   *  prompt context (so the agent sees the same words the human sees). */
  description: string;
  /** Tailwind class for the status dot. Limited to a 4-color palette
   *  (positive / accent-active / warning / muted) — see palette comment. */
  dotClass: string;
  /** Tailwind class for the badge tag chip. */
  tagClass: string;
  /** Which summary-chip bucket this state contributes to. */
  counterCategory: ProjectCounterCategory;
  /** When the state itself indicates the user must act, this is the
   *  remediation hint surfaced in tooltip + action chip. Null = no problem. */
  problem: { hint: string; ctaLabel?: string; ctaHref?: string } | null;
};

/* ── Color palette discipline ────────────────────────────────────────────────
 *
 * Four meanings, four colors. The user complaint was "gray, green, brown,
 * whatever" — the fix is to keep the palette finite and tie each color to a
 * clear semantic:
 *
 *   accent-primary (blue) + pulse  → ONE thing only: agent actively executing.
 *                                    Earns the eye-pull because it's the only
 *                                    state where the agent is mid-turn.
 *   status-positive (green)        → "Good thing just happened" — handoff,
 *                                    orchestration complete, clean exit.
 *   status-warning (amber)         → "User must act" — runner offline.
 *   border-default (muted gray)    → "Inert, nothing happening" — collapses
 *                                    the former gray/brown/border-strong mix
 *                                    into one honest non-color. open_idle +
 *                                    not_running + tab_open + closing all
 *                                    read the same because they're all
 *                                    "ambient, no event, no action needed".
 *
 * If you want to introduce a fifth color, add a meaning the existing four
 * cannot honestly express — don't introduce a hue for a nuance.
 */

export const STATE_DEFINITIONS: Record<ProjectStateKey, ProjectStateDefinition> = {
  offline: {
    label: "Offline",
    description:
      "The builder hasn't pushed fresh state for this project — we don't know what's happening right now.",
    dotClass: "bg-status-warning",
    tagClass: "ui-tag ui-tag-warning",
    counterCategory: "offline",
    problem: {
      hint: "Press Start building or dispatch from Control — the cloud builder or desktop app will pick it up.",
      ctaLabel: "Get desktop app",
      ctaHref: "/download",
    },
  },
  not_running: {
    label: "Not running",
    description: "No agent process and no terminal tab detected for this project.",
    dotClass: "bg-border-default",
    tagClass: "ui-tag ui-tag-neutral",
    counterCategory: "idle",
    problem: null,
  },
  // Agents the user runs outside Fleet Runner (their own terminal, kitty,
  // multi-project shells) are invisible to live process detection.
  // Hook-captured dispatches and orchestration runs still land in Loki —
  // when one is recent, "Not running" is a lie the recorded facts contradict.
  // Counts as idle (it is NOT a live-process claim), but the badge stops
  // asserting death the evidence disproves.
  recently_active: {
    label: "Active recently",
    description:
      "No live agent process is visible to Loki, but a dispatch or run landed for this project recently — work likely happened in a terminal Loki can't observe.",
    dotClass: "bg-status-positive",
    tagClass: "ui-tag ui-tag-neutral",
    counterCategory: "idle",
    problem: null,
  },
  tab_open: {
    label: "Tab open",
    description:
      "Terminal workspace exists for this project but no agent process is running in it.",
    dotClass: "bg-border-default",
    tagClass: "ui-tag ui-tag-neutral",
    counterCategory: "idle",
    problem: null,
  },
  open_idle: {
    label: "Agent idle",
    description:
      "Agent process detected but no recent lifecycle signal. It may be at a prompt, stalled, or simply quiet; Loki has no evidence that it asked you a question.",
    dotClass: "bg-border-default",
    tagClass: "ui-tag ui-tag-neutral",
    counterCategory: "idle",
    problem: null,
  },
  working: {
    label: "Working",
    description: "Agent is mid-turn — actively reading files, calling tools, or writing.",
    dotClass: "bg-accent-primary animate-pulse",
    tagClass: "ui-tag ui-tag-accent",
    counterCategory: "working",
    problem: null,
  },
  ready: {
    label: "Ready for next step",
    description:
      "Stop hook fired recently — the agent finished a turn and is ready for the next instruction. The handoff lists the suggested next move.",
    dotClass: "bg-status-positive",
    tagClass: "ui-tag ui-tag-positive",
    counterCategory: "waiting",
    problem: null,
  },
  orchestration_ready: {
    label: "Ready for next step",
    description:
      "Latest orchestration run completed and produced a result. Pick the next intent or accept the suggested next-best.",
    dotClass: "bg-status-positive",
    tagClass: "ui-tag ui-tag-positive",
    counterCategory: "waiting",
    problem: null,
  },
  closing: {
    label: "Closing",
    description: "Closing hook fired — the agent process is shutting down.",
    dotClass: "bg-border-default",
    tagClass: "ui-tag ui-tag-neutral",
    counterCategory: "idle",
    problem: null,
  },
  completed: {
    label: "Completed",
    description: "Closed hook fired — the agent exited cleanly.",
    dotClass: "bg-status-positive",
    tagClass: "ui-tag ui-tag-positive",
    counterCategory: "idle",
    problem: null,
  },
};

/* ── Lookup helpers ──────────────────────────────────────────────────────────
 *
 * Consumers either read STATE_DEFINITIONS directly or use these named
 * helpers for the most common lookups.
 */

export function projectStateLabel(key: ProjectStateKey): string {
  return STATE_DEFINITIONS[key].label;
}

/** The descriptive sentence — shipped both as the hover tooltip and as
 *  the prompt-context line so the human and the agent read the same words. */
export function projectStateDescription(key: ProjectStateKey): string {
  return STATE_DEFINITIONS[key].description;
}

/* ── Runner-side states ──────────────────────────────────────────────────────
 *
 * The runner banner uses a different state space than the per-project badge —
 * a single user can have many project states at once but only ever one runner
 * connectivity state. Same shape as the per-project SSOT so the banner gets
 * the same hover-tooltip + problem-CTA treatment automatically.
 */

export const RUNNER_STATES = [
  "setup_needed", // The runner has never been seen — first-run path.
  "offline", // Runner was seen but the last push exceeded the offline threshold.
  "state_unknown", // We have a connection but the runner hasn't pushed a valid state yet.
  "connected", // Healthy — runner pushed within the freshness window.
] as const;

export type RunnerStateKey = (typeof RUNNER_STATES)[number];

export type RunnerStateDefinition = {
  label: string;
  description: string;
  dotClass: string;
  tagClass: string;
  problem: { hint: string; ctaLabel?: string; ctaHref?: string } | null;
};

export const RUNNER_STATE_DEFINITIONS: Record<RunnerStateKey, RunnerStateDefinition> = {
  setup_needed: {
    label: EXECUTOR_COPY.builder.setupOptional,
    description:
      "No builder has reported in yet. Git-backed projects can still queue from the browser when the cloud builder is running.",
    dotClass: "bg-border-default",
    tagClass: "ui-tag ui-tag-neutral",
    problem: {
      hint: "Optional: install the desktop app to also run agents on this computer.",
      ctaLabel: "Get desktop app",
      ctaHref: "/download",
    },
  },
  offline: {
    label: EXECUTOR_COPY.builder.offline,
    description:
      "No builder is connected. Dispatches queue until the cloud builder or desktop app is online.",
    dotClass: "bg-status-warning",
    tagClass: "ui-tag ui-tag-warning",
    problem: {
      hint: "Work stays queued. Open the desktop app on this computer, or ensure the cloud builder service is running.",
    },
  },
  state_unknown: {
    label: EXECUTOR_COPY.builder.uncertain,
    description: "A builder is connected but hasn't pushed usable state yet. Wait a few seconds.",
    dotClass: "bg-status-warning",
    tagClass: "ui-tag ui-tag-warning",
    problem: null,
  },
  connected: {
    label: EXECUTOR_COPY.builder.online,
    description: "A builder pushed state recently — cloud and/or this computer.",
    dotClass: "bg-status-positive",
    tagClass: "ui-tag ui-tag-positive",
    problem: null,
  },
};

/** Derive the runner's state from the same fields ControlFleetStatus.tsx
 *  already computes locally (runnerNeverSeen / runnerOffline / etc.). One
 *  signal in, one key out — the components below stop hand-rolling label /
 *  dot / tone trees and read the SSOT instead. */
export function deriveRunnerStateKey(signals: {
  neverSeen: boolean;
  offline: boolean;
  stateUnknown: boolean;
}): RunnerStateKey {
  if (signals.neverSeen) return "setup_needed";
  if (signals.offline) return "offline";
  if (signals.stateUnknown) return "state_unknown";
  return "connected";
}

/** Coarse derivation of a ProjectStateKey from the raw signal set the
 *  runner and the API routes carry around — primarily for places that
 *  want to prepend the SSOT description to the agent prompt context but
 *  don't want to pull in the full presenter machinery.
 *
 *  Inputs map 1:1 onto the columns in `project_states` (DB) and the
 *  `/tmp/agent-*-<tab>` sentinel files (local runtime). Either source can
 *  drive this; just pass whichever pair of fields you have.
 *
 *  Granular fields like `currentPrompt` aren't checked here because the
 *  callers using this helper are about to ENQUEUE a new prompt, not
 *  observe one in flight. */
export function deriveProjectStateKey(signals: {
  agentRunning?: boolean;
  tabOpen?: boolean;
  sessionStatus?: string | null;
  readyAt?: number | null;
  lockAt?: number | null;
  closingAt?: number | null;
  closedAt?: number | null;
  runnerOffline?: boolean;
}): ProjectStateKey {
  const now = Math.floor(Date.now() / 1000);
  const within = (t: number | null | undefined, windowS: number) =>
    typeof t === "number" && t > 0 && now - t < windowS;
  if (signals.runnerOffline) return "offline";
  if (within(signals.closedAt, 60)) return "completed";
  if (within(signals.closingAt, 60)) return "closing";
  if (within(signals.readyAt, 60)) return "ready";
  if (within(signals.lockAt, 60)) return "working";
  if (signals.sessionStatus === SESSION_STATUS.WORKING) return "working";
  // Session handoff says "ready" — the agent just finished a turn and
  // wrote its handoff. Treat that the same as the (now retired) Stop-hook
  // readyAt sentinel: it's the agent's own self-reported done signal.
  // Before this branch was added (2026-06-11), removing the bash Stop hook
  // in Session 1 of killing-the-bash-daemon meant readyAt stopped being
  // written, so projects whose session said "ready" fell through to
  // open_idle ("Agent idle") even seconds after Fleet Runner pushed
  // the fresh status. The /control card read like the runner was offline
  // when in fact it had just synced.
  if (signals.sessionStatus === SESSION_STATUS.READY) return "ready";
  if (signals.agentRunning) return "open_idle";
  if (signals.tabOpen) return "tab_open";
  return "not_running";
}
