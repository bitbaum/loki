import { utcDayKey } from "@/lib/ai-budget/fair-share";

/**
 * The public chat's own allowance of the free model pool.
 *
 * Visitor turns used to be charged to the widget OWNER's personal fair share.
 * The owner of the studio site is also its heaviest Loki user, so by the
 * middle of the day that share was spent or paced and every visitor got the
 * keyword fallback — measured 2026-10-17: every live question answered by
 * keywords in under 700 ms, never once by a model, including "can you build
 * something for research?" from a first-time visitor. A stranger's first
 * question should not depend on how much the person who embedded the widget
 * talked to their own assistant that morning.
 *
 * So visitors draw from one pool of their own: a fixed slice of the day's
 * capacity, shared by every widget, counted in this process. Per-IP and
 * per-token rate limits (the route) still stop one visitor or one site from
 * emptying it. In memory on purpose: a restart that forgets the count gives
 * visitors at most one extra slice, and the hot path stays free of a write.
 *
 * Pure apart from the counter; `now` and capacity are passed in for tests.
 */

/** The visitors' slice of the day: enough for a few hundred answers, never most of the pool. */
export const VISITOR_POOL_SHARE = 0.12;
/**
 * What one concierge turn is assumed to cost before it runs. The concierge
 * prompt is the facts block (≤ 9k chars ≈ 2.5k tokens) plus a 1.6k answer
 * budget — not the 20k a tool-calling Loki turn reserves.
 */
export const VISITOR_TURN_RESERVE = 6_000;

let pool = { day: "", spent: 0 };

function today(now: Date): typeof pool {
  const day = utcDayKey(now);
  if (pool.day !== day) pool = { day, spent: 0 };
  return pool;
}

/** May a visitor's question go to a model now? */
export function visitorPoolAllows(capacityTokens: number, now = new Date()): boolean {
  const cap = Math.floor(capacityTokens * VISITOR_POOL_SHARE);
  return today(now).spent + VISITOR_TURN_RESERVE <= cap;
}

/** Book what an answered turn cost; 0 (unreported) books the reserve. */
export function recordVisitorSpend(tokens: number, now = new Date()): void {
  today(now).spent += tokens > 0 ? Math.round(tokens) : VISITOR_TURN_RESERVE;
}

/** Test seam: forget today's count. */
export function resetVisitorPool(): void {
  pool = { day: "", spent: 0 };
}
