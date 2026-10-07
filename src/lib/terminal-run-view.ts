/**
 * Terminal right-rail commentary — phase, stall, next action — derived from
 * the same work-phase + run_events hop Watch uses. Not a log dump.
 */
import { looksLikeAgentCapacityIssue } from "@/lib/agent-resolution";
import { FEEDBACK_WORK_PHASE, type FeedbackWorkView } from "@/lib/feedback/work-phase";

export type TerminalRunView = {
  runId: string;
  projectKey: string;
  phase: string;
  label: string;
  stepSummary: string;
  nextAction: string;
  stalled: boolean;
  diagnostic: string | null;
  terminalReady: boolean;
  lastProgressAt: string | null;
  /**
   * This run died on a capacity wall, so the rail offers the provider chooser.
   *
   * The list of WHICH providers is no longer computed here. It used to be —
   * every alternative in config order, unfiltered — and the rail rendered it
   * verbatim, offering agents the connected builder had never installed. The
   * ranking now lives in one place (`/api/providers` over
   * `src/lib/provider-switch.ts`) and is shared with Feedback and Control, so
   * this flag says only whether to ask it.
   */
  quotaDeath: boolean;
};

export type TerminalRunPresentation = Pick<TerminalRunView, "label" | "stepSummary" | "nextAction">;

/** What the terminal knows about its own byte stream. Mirrors
 *  TerminalView's onLive states; `idle` means no session is selected. */
export type TerminalPtyState = "live" | "connecting" | "stalled" | "idle";

export const SESSION_LOST_LABEL = "Not responding";

/** A durable run row can outlive its PTY (runner restart, crash, or manual
 * stop). The terminal knows whether bytes can actually flow, so it must not
 * repeat the run ledger's old "Working / generating" claim when the session
 * has stopped answering.
 *
 * "Connecting" is NOT that. This used to take a boolean, and every state but
 * "live" read as gone — so opening Terminal on a phone (where the Loki sheet
 * opened on top of the session) announced "Session ended — its agent terminal
 * is gone" for the seconds it took to attach, over a session that was
 * running fine (operator, 2026-10-07). Until the stream has had its chance,
 * the ledger's word stands. */
export function presentTerminalRun(
  view: TerminalRunView,
  pty: TerminalPtyState,
): TerminalRunPresentation {
  if (pty !== "stalled" || view.phase !== FEEDBACK_WORK_PHASE.WORKING) {
    return view;
  }
  return {
    label: SESSION_LOST_LABEL,
    stepSummary: "The agent's screen stopped answering",
    nextAction:
      "Usually the builder restarting — it reconnects by itself. If it stays like this, open the project and send the task again.",
  };
}

/** Did this run die because the agent ran out of capacity? */
export function isQuotaDeath(input: {
  diagnostic?: string | null;
  error?: string | null;
}): boolean {
  const text = [input.diagnostic, input.error].filter(Boolean).join(" ");
  return !!text && looksLikeAgentCapacityIssue(text);
}

/** What a working run's "next action" says when there is nothing to do but
 *  watch. Named so the rail can recognise it and not print it. */
export const WORKING_NEXT_ACTION =
  "Agent is generating. Inject to steer this session, or Ask Loki about the run.";

/** Step summaries that only restate the badge ("Working · 2 min"). */
const RESTATES_BADGE = new Set(["Agent is generating", "Agent is working"]);

/**
 * The lines the rail prints under its badge — only the ones that add
 * something. A working run used to read "Working · 2 min" / "Agent is working"
 * / "Agent is generating. Inject to steer…": one fact three times, above the
 * actual content (operator, 2026-10-05). The composer under the rail already
 * offers Ask and Inject, so the sentence telling you so is dropped too.
 */
export function railStatusLines(p: TerminalRunPresentation): {
  summary: string | null;
  next: string | null;
} {
  const summary =
    RESTATES_BADGE.has(p.stepSummary) || p.stepSummary === p.label ? null : p.stepSummary;
  const next =
    p.nextAction === WORKING_NEXT_ACTION ||
    p.nextAction === p.label ||
    p.nextAction === p.stepSummary
      ? null
      : p.nextAction;
  return { summary, next };
}

export function nextActionForWork(work: FeedbackWorkView, quotaDeath = false): string {
  // Deliberately does not name the alternatives. It used to list all five, and
  // that sentence went stale the moment the chooser started filtering to the
  // ones actually installed — the prose promised Cursor while the button below
  // it said Cursor was not installed.
  if (quotaDeath) return "Quota empty — switch to a provider that still has some.";
  if (work.queueReason) return work.queueReason;
  if (work.detail) return work.detail;
  if (work.phase === FEEDBACK_WORK_PHASE.WORKING) return WORKING_NEXT_ACTION;
  if (work.phase === FEEDBACK_WORK_PHASE.QUEUED) {
    return work.stepSummary ?? "Waiting for the builder.";
  }
  return work.label;
}

export function buildTerminalRunView(input: {
  runId: string;
  projectKey: string;
  work: FeedbackWorkView;
  lastProgressAt?: string | null;
  error?: string | null;
}): TerminalRunView {
  const quotaDeath = isQuotaDeath({ diagnostic: input.work.diagnostic, error: input.error });
  return {
    runId: input.runId,
    projectKey: input.projectKey,
    phase: input.work.phase,
    label: input.work.label,
    stepSummary: input.work.stepSummary ?? input.work.label,
    nextAction: nextActionForWork(input.work, quotaDeath),
    stalled:
      input.work.phase === FEEDBACK_WORK_PHASE.STUCK ||
      input.work.phase === FEEDBACK_WORK_PHASE.FAILED,
    diagnostic: input.work.diagnostic ?? null,
    terminalReady: input.work.terminalReady === true,
    lastProgressAt: input.lastProgressAt ?? input.work.lastActivityAt ?? null,
    quotaDeath,
  };
}
