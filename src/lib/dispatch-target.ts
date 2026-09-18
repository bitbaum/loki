/**
 * What is about to happen, said before the operator presses the button.
 *
 * Agent, model and machine are each SETTABLE on the project profile — three
 * separate controls, stacked — and nowhere were the three shown together as the
 * sentence they add up to. So the operator chose a builder in one row, a model
 * two rows down, and dispatched without ever seeing the combination; the first
 * statement of what actually ran arrived afterwards, on the run record.
 *
 * "Known cost/quota" is deliberately the LAST RUN's, not a forecast. What this
 * dispatch will cost is unknowable before it runs, and a predicted number
 * printed next to a button reads as a quote. What the previous run on this
 * project cost is a measured fact, and it is the best available answer to "what
 * am I about to spend" — labelled as the past, never as an estimate.
 */

import { EXECUTOR_COPY } from "@/config/executor-copy";
import { looksLikeAgentCapacityIssue } from "@/lib/agent-resolution";

export type DispatchTarget = {
  /** Agent's display label, e.g. "Claude Code". */
  agentLabel: string;
  /** Resolved model for that agent, when the agent exposes a choice. */
  model?: string | null;
  /** Where it will run. Null when the project has not pinned a tier. */
  channel?: string | null;
  /** The previous run on this project — measured, never predicted. */
  lastRun?: {
    costUsd?: number | null;
    /** payload.error, read only to recognise a capacity wall. */
    error?: string | null;
  } | null;
};

export type DispatchTargetView = {
  /** "Claude Code · opus · This computer" */
  line: string;
  /** What the last run cost, as a measured fact. Null when never priced. */
  cost: string | null;
  /** A warning the operator should read BEFORE dispatching, or null. */
  caution: string | null;
};

function channelLabel(channel: string | null | undefined): string | null {
  if (channel === "local") return EXECUTOR_COPY.builder.localChoice;
  if (channel === "cloud") return EXECUTOR_COPY.builder.cloudChoice;
  if (channel === "hosted") return EXECUTOR_COPY.builder.hostedChoice;
  return null;
}

/**
 * Format a measured cost.
 *
 * Sub-cent runs render as "<$0.01" rather than "$0.00": a real run that cost
 * something must not print as free, which is the kind of rounding that turns a
 * measurement back into a claim.
 */
function formatCost(costUsd: number | null | undefined): string | null {
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0) return null;
  if (costUsd === 0) return "$0.00";
  if (costUsd < 0.01) return "<$0.01";
  return `$${costUsd.toFixed(2)}`;
}

export function describeDispatchTarget(target: DispatchTarget): DispatchTargetView {
  const parts = [target.agentLabel.trim()].filter(Boolean);
  const model = target.model?.trim();
  if (model) parts.push(model);
  const where = channelLabel(target.channel);
  if (where) parts.push(where);

  const cost = formatCost(target.lastRun?.costUsd);

  // The one piece of quota evidence available without asking anything: the
  // previous run on this project died with capacity language. It does not prove
  // the wall is still up — quota refills — so it says "may", and it is the
  // operator's call, not a block.
  const lastError = target.lastRun?.error?.trim() ?? "";
  const caution =
    lastError && looksLikeAgentCapacityIssue(lastError)
      ? `${target.agentLabel} hit a capacity limit on its last run here — it may still be spent.`
      : null;

  return { line: parts.join(" · "), cost, caution };
}
