import { looksLikeAgentCapacityIssue } from "@/lib/agent-resolution";

/**
 * The pure half of feedback/auto-reimplement.ts: which runner refusals earn
 * Loki's own second attempt, and the sentence the row shows. No I/O, so
 * work-phase.ts (which is pure and unit-tested without a database) can read
 * it, and the policy is testable on its own.
 */
const AUTH_RE =
  /not authenticated|\b401\b|login required|not logged in|setup-token|rejected token|mint a new one/i;
/** The runner could not even read the command — a second copy reads the same. */
const PROTOCOL_RE =
  /payload missing|payload field|does not handle command type|must be (?:a string|an object)/i;
const WORKSPACE_RE =
  /not materializable|does not exist (?:here|on this machine)|no cloneable|nothing was launched here/i;
const NO_GENERATION_RE =
  /could not verify generation|produced no response|waiting for workspace trust|inject did not stick|never started generating/i;

export type AutoReimplementDecision =
  | { retry: true; because: string }
  | {
      retry: false;
      reason: "already-retried" | "needs-auth" | "needs-workspace" | "not-retryable" | "no-error";
    };

/** Pure: whether the runner's refusal is one a second attempt can answer. */
export function decideAutoReimplement(
  error: string | null | undefined,
  payload: { priorRunId?: unknown; feedbackAutoRetriedAt?: unknown } | null | undefined,
): AutoReimplementDecision {
  if (payload?.priorRunId || payload?.feedbackAutoRetriedAt) {
    return { retry: false, reason: "already-retried" };
  }
  const text = (error ?? "").trim();
  if (!text) return { retry: false, reason: "no-error" };
  if (AUTH_RE.test(text)) return { retry: false, reason: "needs-auth" };
  if (WORKSPACE_RE.test(text)) return { retry: false, reason: "needs-workspace" };
  if (looksLikeAgentCapacityIssue(text)) {
    return { retry: true, because: "the agent hit its usage limit" };
  }
  if (NO_GENERATION_RE.test(text)) {
    return { retry: true, because: "the agent opened but never started generating" };
  }
  if (PROTOCOL_RE.test(text)) return { retry: false, reason: "not-retryable" };
  // Anything else the runner refused with is worth exactly one more attempt on
  // a provider with quota: the cost is one dispatch, the guard is the stamp,
  // and the alternative is a "Failed" row nobody is looking at.
  return { retry: true, because: "the first attempt was refused by the builder" };
}

/** One sentence for the row: what happened and that Loki already acted on it. */
export function autoRetryNotice(because: string): string {
  return `Retried automatically — the first attempt failed because ${because}.`;
}
