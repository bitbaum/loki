import { looksLikeAgentCapacityIssue, looksLikeAgentNoAnswer } from "@/lib/agent-resolution";

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

export type AutoReimplementDecision =
  | { retry: true; because: string; failover?: true; failoverWhy?: string }
  | {
      retry: false;
      reason: "already-retried" | "needs-auth" | "needs-workspace" | "not-retryable" | "no-error";
    };

/** Pure: whether the runner's refusal is one a second attempt can answer. */
export function decideAutoReimplement(
  error: string | null | undefined,
  payload:
    | { priorRunId?: unknown; feedbackAutoRetriedAt?: unknown; providersTried?: unknown }
    | null
    | undefined,
): AutoReimplementDecision {
  const text0 = (error ?? "").trim();
  // A quota wall is the one failure that CHAINS: each hop runs on a provider
  // not yet tried, so the loop is bounded by the provider list itself, not by
  // a single-retry stamp. Checked before the stamp guard on purpose.
  if (
    text0 &&
    !AUTH_RE.test(text0) &&
    !payload?.feedbackAutoRetriedAt &&
    looksLikeAgentCapacityIssue(text0)
  ) {
    return {
      retry: true,
      because: "the agent ran out of quota",
      failover: true,
      failoverWhy: "ran out of quota",
    };
  }
  // An agent that never took the prompt (it sat in the composer, the CLI
  // stayed silent) chains the same way: the next provider is tried, never the
  // same one again (Antigravity, 2026-10-21).
  if (
    text0 &&
    !AUTH_RE.test(text0) &&
    !payload?.feedbackAutoRetriedAt &&
    looksLikeAgentNoAnswer(text0)
  ) {
    return {
      retry: true,
      because: "the agent opened but never accepted the prompt, so it runs on the next provider",
      failover: true,
      failoverWhy: "never accepted the prompt",
    };
  }
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
  if (looksLikeAgentNoAnswer(text)) {
    // The retry goes through implementFeedback → routeAroundSpent, which now
    // counts this as the provider being unable to answer — so the second
    // attempt runs on the next provider in the operator's order, not on the
    // agent that just stayed silent.
    return {
      retry: true,
      because: "the agent opened but never answered, so it runs on the next provider",
    };
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

/**
 * Pure: the providers a quota failover chain has tried, this run included,
 * in order and without repeats.
 */
export function providersTriedAfter(
  payload: { providersTried?: unknown } | null | undefined,
  thisRunAdapter: string | null | undefined,
): string[] {
  const before = Array.isArray(payload?.providersTried)
    ? payload.providersTried.filter((x): x is string => typeof x === "string")
    : [];
  const all = thisRunAdapter ? [...before, thisRunAdapter] : before;
  return [...new Set(all)];
}

/** Pure: the first provider in `order` that is usable and not yet tried. */
export function nextFailoverProvider(
  order: readonly string[],
  tried: readonly string[],
  usable: (id: string) => boolean = () => true,
): string | null {
  return order.find((id) => !tried.includes(id) && usable(id)) ?? null;
}
