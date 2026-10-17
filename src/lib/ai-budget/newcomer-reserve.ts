import { DAY_MS } from "@/lib/constants/time";

/**
 * The part of each day's free pool held back for people trying Loki for the
 * first time.
 *
 * Pacing (ai-kit fair-share) keeps the day from being spent before lunch, but
 * it cannot keep it from being spent by evening: there is no clawback, and the
 * people who arrived first legitimately used their larger shares. Whoever signs
 * up at 21:00 then meets a pool the vendors have already refused — a share on
 * paper with nothing behind it — and a first answer that never comes is the
 * moment a person decides the product is broken and leaves. Returning people
 * know what Loki does and have a way past the pool (their own key, a plan);
 * someone on day one has neither.
 *
 * So returning accounts, together, stop at (1 − NEWCOMER_RESERVE) of the day's
 * capacity. An account younger than NEWCOMER_DAYS may draw on the rest, still
 * under its own fair share like everyone else.
 *
 * Pure: the numbers in, a verdict out.
 */
export const NEWCOMER_RESERVE = 0.2;
export const NEWCOMER_DAYS = 7;

export function isNewcomer(createdAt: Date | null | undefined, now: Date): boolean {
  if (!createdAt) return false;
  return now.getTime() - createdAt.getTime() < NEWCOMER_DAYS * DAY_MS;
}

/** Would this turn reach into the part of today's pool held for newcomers? */
export function reachesReserve(
  capacity: number,
  totalSpentTokens: number,
  costTokens: number,
): boolean {
  if (capacity <= 0) return false;
  return totalSpentTokens + costTokens > capacity * (1 - NEWCOMER_RESERVE);
}
