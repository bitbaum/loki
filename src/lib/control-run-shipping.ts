/**
 * Where a run's CHANGE got to, for the Control card.
 *
 * A run's `outcome` grades the agent's attempt and is stamped once, at close —
 * necessarily before the pull request is merged and the box redeployed. The fix
 * ledger (`payload.fix`, see lib/feedback/fix-shipping.ts) grades the change and
 * keeps moving after the run is closed. They answer different questions.
 *
 * Control only ever read the first one, so a run that closed `partial` and then
 * merged and deployed read on the card as unfinished work — the operator saw
 * "partial" and concluded nothing had shipped, while the Feedback row two
 * surfaces away already said "PR #757 · merged". One fact, two answers; that is
 * the disagreement this closes.
 *
 * Deliberately NOT a second grade. Nothing here rewrites the outcome: a merged
 * pull request does not prove the run's definition-of-done bar was met, so the
 * verdict stands and the card simply also reports where the change is.
 *
 * The long-form operator copy for these states lives in
 * lib/feedback/work-phase.ts, which is the Feedback row's voice. This is the
 * short form for a card with one line to spend; both read the same
 * FIX_SHIP_STATE constants, so a new state cannot appear in one and not the
 * other.
 */

import { FIX_SHIP_STATE, type FixShipState } from "@/lib/feedback/fix-shipping";

/** The ledger as the control plane carries it — the facts a card can render,
 *  not the whole ledger. */
export type RunShipping = {
  state: FixShipState;
  prNumber?: number;
  prUrl?: string;
  /** The deploy workflow's name, when one ran on the merge commit. */
  deployName?: string;
};

/** `state` arrives as a bare string from jsonb. Validate it, never cast: an
 *  unknown state must drop the whole block rather than render a raw enum value
 *  at the operator — the same rule `evidence.kind` already follows. */
const SHIP_STATES = new Set<string>(Object.values(FIX_SHIP_STATE));

export function normalizeRunShipping(raw: unknown): RunShipping | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const fix = raw as {
    state?: unknown;
    pr?: { number?: unknown; url?: unknown } | null;
    deploy?: { name?: unknown } | null;
  };
  if (typeof fix.state !== "string" || !SHIP_STATES.has(fix.state)) return undefined;
  const prNumber = typeof fix.pr?.number === "number" ? fix.pr.number : undefined;
  const prUrl = typeof fix.pr?.url === "string" ? fix.pr.url : undefined;
  const deployName = typeof fix.deploy?.name === "string" ? fix.deploy.name : undefined;
  return {
    state: fix.state as FixShipState,
    ...(prNumber !== undefined ? { prNumber } : {}),
    ...(prUrl ? { prUrl } : {}),
    ...(deployName ? { deployName } : {}),
  };
}

/**
 * Did the change demonstrably reach production?
 *
 * The card warns "no commit" when a run claims work but recorded no commit SHA.
 * That warning is read off the run's own self-report, and a merged, deployed
 * pull request outranks it: the work plainly landed, whatever the handoff
 * failed to write down. Without this the card showed "no commit" directly
 * beside "merged and deployed" — the same one-fact-graded-twice this module
 * exists to end.
 */
export function shippingLanded(fix: RunShipping | undefined | null): boolean {
  return fix?.state === FIX_SHIP_STATE.DEPLOYED;
}

/**
 * The one line the card shows, or null when the ledger adds nothing a reader
 * could act on.
 *
 * `no_evidence` and `pushed` are omitted on purpose: the first says the ledger
 * looked and found nothing, which an unadorned outcome already implies, and the
 * second is a branch with no pull request. Neither contradicts the outcome the
 * card is already showing, so neither earns the line.
 */
export function describeRunShipping(fix: RunShipping | undefined | null): string | null {
  if (!fix) return null;
  const pr = fix.prNumber ? `#${fix.prNumber}` : "the change";
  switch (fix.state) {
    case FIX_SHIP_STATE.PR_OPEN:
      return `${pr} open — not live yet`;
    case FIX_SHIP_STATE.PR_CLOSED:
      return `${pr} closed without merging`;
    case FIX_SHIP_STATE.MERGED:
      return `${pr} merged — no deploy ran on the merge commit`;
    case FIX_SHIP_STATE.DEPLOYING:
      return `${pr} merged — ${fix.deployName ?? "the deploy"} is running`;
    case FIX_SHIP_STATE.DEPLOY_FAILED:
      return `${pr} merged, but ${fix.deployName ?? "the deploy"} failed`;
    case FIX_SHIP_STATE.DEPLOYED:
      return `${pr} merged and deployed`;
    default:
      return null;
  }
}
