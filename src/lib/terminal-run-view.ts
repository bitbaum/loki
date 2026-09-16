/**
 * Terminal right-rail commentary — phase, stall, next action — derived from
 * the same work-phase + run_events hop Watch uses. Not a log dump.
 */
import { looksLikeAgentCapacityIssue } from "@/lib/agent-resolution";
import { QUOTA_ALTERNATIVE_AGENTS, type QuotaAlternative } from "@/config/quota-alternatives";
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
  quotaDeath: boolean;
  alternatives: QuotaAlternative[];
};

export function quotaDeathAlternatives(input: {
  diagnostic?: string | null;
  error?: string | null;
  currentAgent?: string | null;
}): QuotaAlternative[] | null {
  const text = [input.diagnostic, input.error].filter(Boolean).join(" ");
  if (!text || !looksLikeAgentCapacityIssue(text)) return null;
  const current = (input.currentAgent ?? "").toLowerCase();
  const list = QUOTA_ALTERNATIVE_AGENTS.filter((a) => a.id !== current);
  return list.length ? [...list] : null;
}

export function nextActionForWork(work: FeedbackWorkView, quotaDeath = false): string {
  if (quotaDeath) return "Quota empty — try Claude Code, Codex, Cursor, Grok, or Antigravity.";
  if (work.queueReason) return work.queueReason;
  if (work.detail) return work.detail;
  if (work.phase === FEEDBACK_WORK_PHASE.WORKING) {
    return "Agent is generating. Inject to steer this session, or Ask Loki about the run.";
  }
  if (work.phase === FEEDBACK_WORK_PHASE.QUEUED) {
    return work.stepSummary ?? "Waiting for the builder.";
  }
  return work.label;
}

export function buildTerminalRunView(input: {
  runId: string;
  projectKey: string;
  work: FeedbackWorkView;
  currentAgent?: string | null;
  lastProgressAt?: string | null;
  error?: string | null;
}): TerminalRunView {
  const alternatives = quotaDeathAlternatives({
    diagnostic: input.work.diagnostic,
    error: input.error,
    currentAgent: input.currentAgent,
  });
  const quotaDeath = alternatives !== null;
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
    alternatives: alternatives ?? [],
  };
}
