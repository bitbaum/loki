import { EXECUTOR_COPY } from "@/config/executor-copy";
import type { StatusTone, BuilderChannel } from "@/lib/constants/statuses";
import { ORCH_STATE } from "@/lib/orchestration/contract";

export type DispatchStatusInput = {
  ok?: boolean;
  mode?: string | null;
  warning?: string | null;
  runnerConnected?: boolean | null;
  /**
   * Which builder took it. Optional because older persisted messages predate
   * routing being recorded — those still render the unnamed copy rather than
   * guessing a machine they were never dispatched to.
   */
  channel?: BuilderChannel | null;
};

/**
 * The builder named for a sentence, or null when we genuinely don't know.
 *
 * Never guess. A label that names the wrong machine is worse than one that
 * names none: the operator goes looking for their work on a computer that
 * never had it.
 */
function builderName(channel: BuilderChannel | null | undefined): string | null {
  return channel ? (EXECUTOR_COPY.ranOn[channel] ?? null) : null;
}

/** SSOT for dispatch outcome copy — Loki footer, Control toasts, etc. */
export function dispatchStatusLabel(input: DispatchStatusInput): { label: string; warn: boolean } {
  if (input.ok === false) {
    return { label: "Dispatch failed", warn: true };
  }
  const on = builderName(input.channel);
  if (
    input.warning === "runner-offline" ||
    (input.mode === "queued" && input.runnerConnected === false)
  ) {
    // The most valuable place to name the builder: this says WHY nothing is
    // happening and which machine to wake, instead of a generic "offline".
    return {
      label: on ? `Queued for ${on} — runs when it's online` : EXECUTOR_COPY.queuedWhenOffline,
      warn: true,
    };
  }
  if (input.mode === "direct") {
    return { label: on ? `Running now on ${on}` : "Running now", warn: false };
  }
  if (input.mode === "queued") {
    return {
      label: on ? `With ${on} — starting shortly` : EXECUTOR_COPY.queuedWithBuilderOnline,
      warn: false,
    };
  }
  return { label: on ? `Dispatched to ${on}` : "Dispatched", warn: false };
}

export function dispatchAssistantContent(projectKey: string, input: DispatchStatusInput): string {
  if (input.ok === false) {
    return `Could not dispatch to ${projectKey}.`;
  }
  const { label, warn } = dispatchStatusLabel(input);
  const on = builderName(input.channel);
  if (input.mode === "direct") {
    return on
      ? `Running on **${projectKey}** in the agent terminal on ${on} now.`
      : `Running on **${projectKey}** in the agent terminal now.`;
  }
  if (input.mode === "queued" && !warn) {
    return on
      ? `Dispatched **${projectKey}** to ${on} — ${EXECUTOR_COPY.queuedWithBuilderOnlineLong}`
      : `Dispatched **${projectKey}** — ${EXECUTOR_COPY.queuedWithBuilderOnlineLong}`;
  }
  if (warn) {
    return on
      ? `Queued **${projectKey}** for ${on} — ${EXECUTOR_COPY.queuedWhenOfflineLong}`
      : `Queued **${projectKey}** — ${EXECUTOR_COPY.queuedWhenOfflineLong}`;
  }
  void label;
  return `Dispatched **${projectKey}**.`;
}

/** The live lifecycle of a queued dispatch, derived from its pending_command
 *  row. Lets the transcript footer show the truth as it unfolds — queued →
 *  picked up → ran / failed — instead of freezing on the optimistic snapshot
 *  stamped at dispatch time. SSOT for both the status API and the footer. */
export type DispatchLiveStatus =
  | "queued"
  | "working"
  | "delivered"
  | "completed"
  | "partial"
  | "stopped"
  | "unconfirmed"
  | "failed";

export type CommandLiveInput = {
  claimedAt: string | Date | null;
  executedAt: string | Date | null;
  result: {
    ok?: boolean | null;
    verified?: boolean | null;
    warning?: string | null;
    error?: string | null;
  } | null;
  run?: {
    state: string;
    outcome: string | null;
    payload?: { error?: string } | null;
  } | null;
};

export type DispatchLiveView = {
  status: DispatchLiveStatus;
  label: string;
  detail: string | null;
  tone: StatusTone;
  /** true once the command reached a settled state — the footer stops polling. */
  terminal: boolean;
};

/**
 * How long this has been going, in the shortest form that is still precise.
 *
 * Every non-terminal state used to read the same from one second in to twenty
 * minutes in — "waiting for a completion handoff", forever. Observed
 * 2026-09-18: a dispatch sat on that line for five minutes with no elapsed
 * time, no heartbeat and no log, and the only way to learn whether anything
 * had happened was to go and read `git log` in another window. A dead builder
 * and a busy one are the same sentence.
 *
 * Deliberately NOT a judgement. There is no measured baseline for how long a
 * run should take, so this says how long it HAS taken and lets the person
 * decide. Inventing "taking longer than usual" would be a claim nothing here
 * can back.
 */
export function elapsedLabel(since: string | Date | null, now: number = Date.now()): string | null {
  if (!since) return null;
  const started = since instanceof Date ? since.getTime() : Date.parse(since);
  if (!Number.isFinite(started)) return null;
  const secs = Math.floor((now - started) / 1000);
  if (secs < 0) return null;
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

/** `detail`, with the elapsed time appended when there is one to show. */
function withElapsed(detail: string, since: string | Date | null, now: number): string {
  const label = elapsedLabel(since, now);
  return label ? `${detail} · ${label}` : detail;
}

export function deriveDispatchLiveStatus(
  cmd: CommandLiveInput,
  now: number = Date.now(),
): DispatchLiveView {
  const r = cmd.result ?? {};
  if (!cmd.executedAt) {
    if (!cmd.claimedAt) {
      return {
        status: "queued",
        label: "Queued",
        detail: "waiting for a builder to pick it up",
        tone: "neutral",
        terminal: false,
      };
    }
    return {
      status: "working",
      label: "Agent picked up — working",
      detail: withElapsed("running your prompt now", cmd.claimedAt, now),
      tone: "positive",
      terminal: false,
    };
  }
  if (r.ok === false) {
    return {
      status: "failed",
      label: "Dispatch failed",
      detail: r.error ?? "the agent could not run",
      tone: "negative",
      terminal: true,
    };
  }
  if (r.verified === false) {
    return {
      status: "unconfirmed",
      label: "Delivered — not confirmed",
      detail: r.warning ?? "the agent hasn't confirmed it started generating",
      tone: "warning",
      terminal: true,
    };
  }

  const run = cmd.run;
  if (!run) {
    return {
      status: "delivered",
      label: "Delivered to agent",
      detail: "the runner confirmed the prompt was submitted",
      tone: "positive",
      terminal: true,
    };
  }

  if (run.state === ORCH_STATE.WAITING) {
    return {
      status: "delivered",
      label: "Delivered to agent",
      // "completion handoff" is the internal name for it; what a person needs
      // to know is that the agent has the work and has not reported back yet.
      detail: withElapsed("agent has it — no result reported back yet", cmd.executedAt, now),
      tone: "positive",
      terminal: false,
    };
  }
  if (run.state === ORCH_STATE.RUNNING || run.state === ORCH_STATE.CLOSING) {
    return {
      status: "working",
      label: run.state === ORCH_STATE.CLOSING ? "Agent is finishing" : "Agent is working",
      detail: withElapsed("still working", cmd.executedAt, now),
      tone: "positive",
      terminal: false,
    };
  }

  const error = run.payload?.error?.trim() || null;
  switch (run.outcome) {
    case "success":
      return {
        status: "completed",
        label: "Completed",
        detail: "successful outcome recorded",
        tone: "positive",
        terminal: true,
      };
    case "partial":
      return {
        status: "partial",
        label: "Finished with follow-up",
        detail: "the run recorded remaining work",
        tone: "warning",
        terminal: true,
      };
    case "user_abort":
      return {
        status: "stopped",
        label: "Stopped by you",
        detail: null,
        tone: "neutral",
        terminal: true,
      };
    case "hang":
      return {
        status: "failed",
        label: "Agent stopped responding",
        detail: error,
        tone: "negative",
        terminal: true,
      };
    case "timeout":
      return {
        status: "failed",
        label: "Run timed out",
        detail: error,
        tone: "negative",
        terminal: true,
      };
    case "unconfirmed":
      // Deliberately NOT "Run timed out": no agent was ever seen working on
      // this, so pointing the operator at the agent's runtime is a wild goose
      // chase. Equally deliberately not "never reached the agent" — the runner
      // says it injected, and could only fail to confirm. The useful fact is
      // that nothing ran and a retry is free.
      return {
        status: "failed",
        label: "Agent never started",
        detail:
          error ??
          "The prompt was injected but the agent was never seen picking it up. Nothing ran — safe to retry.",
        tone: "negative",
        terminal: true,
      };
    case "error":
      return {
        status: "failed",
        label: "Run failed",
        detail: error,
        tone: "negative",
        terminal: true,
      };
    default:
      return {
        status: "unconfirmed",
        label: "Run closed — outcome missing",
        detail: "check Activity for the recorded evidence",
        tone: "warning",
        terminal: true,
      };
  }
}

// ── Shared presentation helpers ───────────────────────────────────────────

/** SSOT for tone → dot class. Loki's transcript, Control's dispatch banner,
 *  and the terminal composer's status line all render the same four tones —
 *  this was three separate inline `Record<tone, string>` maps before. */
export function dispatchToneDotClass(tone: StatusTone): string {
  switch (tone) {
    case "positive":
      return "ui-dot-positive";
    case "warning":
      return "ui-dot-warning";
    case "negative":
      return "ui-dot-negative";
    default:
      return "ui-dot-neutral";
  }
}

/** One project's outcome from a fan-out dispatch (loki/multi-dispatch.ts). */
export type MultiDispatchAttempt = {
  projectKey: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  mode?: string | null;
};

export type MultiDispatchView = {
  label: string;
  tone: StatusTone;
  /** First project that actually started — the one worth linking to. Null
   *  when nothing started, so the footer offers no "watch it" link to a
   *  session that was never touched. */
  primaryProject: string | null;
};

/**
 * Honest badge for a fan-out ("develop these 3 projects") dispatch.
 *
 * Before this, the footer badge fell through every branch of
 * dispatchStatusLabel (none of which understand `multiDispatch` meta) to the
 * generic, always-green "Dispatched" — so 0-of-3 started read identically to
 * 3-of-3 on the one thing a skimming user actually looks at (the colored
 * dot), even though the reply text right above it correctly said "Started: none".
 */
export function deriveMultiDispatchView(attempts: MultiDispatchAttempt[]): MultiDispatchView {
  const started = attempts.filter((a) => a.ok);
  const total = attempts.length;
  const primaryProject = started[0]?.projectKey ?? null;
  if (total === 0) {
    return { label: "Nothing to dispatch", tone: "neutral", primaryProject: null };
  }
  if (started.length === 0) {
    return {
      label: `Dispatch failed — 0 of ${total} started`,
      tone: "negative",
      primaryProject: null,
    };
  }
  if (started.length < total) {
    return {
      label: `Started ${started.length} of ${total} — ${total - started.length} skipped`,
      tone: "warning",
      primaryProject,
    };
  }
  return { label: `Started all ${total}`, tone: "positive", primaryProject };
}
