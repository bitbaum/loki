import type { Plan } from "@/db/schema/users";

/**
 * OrangeCat/Bitcoin checkout URL for a paid plan, or null while payments are
 * not open.
 *
 * Each paid tier maps to an OrangeCat product/pass with a BTC price; the URL is
 * that pass's OC checkout. TWO things must be true before a button may send a
 * person there: the URL is set (ORANGECAT_PAY_URL_<PLAN>) AND payments are
 * switched on (LOKI_PAYMENTS_OPEN=1). The URL alone is not enough.
 *
 * Why the switch exists: the three URLs were set on the box before the passes
 * existed on OrangeCat. While every paid tier had no price this was invisible;
 * the day prices were set (2026-10-17) every paid plan's button became "Pay in
 * Bitcoin" to an OrangeCat page that answered 404 — skipping the reservation
 * flow it was meant to fall back to. Payments open on the owner's
 * decision; that is a decision, so it is a switch, not an inference. The copy
 * around the switch says only that checkout is not open yet, never why.
 */
export function paymentsOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LOKI_PAYMENTS_OPEN?.trim() === "1";
}

export function orangeCatPayUrl(plan: Plan, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!paymentsOpen(env)) return null;
  const byPlan: Partial<Record<Plan, string | undefined>> = {
    personal: env.ORANGECAT_PAY_URL_PERSONAL,
    pro: env.ORANGECAT_PAY_URL_PRO,
    team: env.ORANGECAT_PAY_URL_TEAM,
  };
  const url = byPlan[plan]?.trim();
  return url ? url : null;
}
