import { PRICING_PLANS, type PricingPlan } from "@/config/plans";
import { orangeCatPayUrl } from "@/lib/oc-pay";
import type { Plan } from "@/db/schema/users";

/**
 * Which paid plans can be reserved, and what a plan's button does now.
 *
 * A plan is reservable when it has a price and is not free. It is BUYABLE
 * only when its OrangeCat pass exists (lib/oc-pay.ts) — then the button pays
 * instead of reserving, and nothing else in the flow changes.
 */
export function reservablePlan(key: string): Plan | null {
  const p = PRICING_PLANS.find((x) => x.key === key);
  return p && p.priceMonthly !== null && p.priceMonthly > 0 ? p.key : null;
}

/** The page a paid plan's button opens: where it is reserved, or paid once payments open. */
export function planCheckoutPath(plan: Plan): string {
  return `/pricing/${plan}`;
}

export type PlanCheckout = { kind: "pay"; url: string } | { kind: "reserve" } | { kind: "none" };

/** What can happen on a plan's checkout page right now. */
export function planCheckout(plan: PricingPlan): PlanCheckout {
  if (!reservablePlan(plan.key)) return { kind: "none" };
  const url = orangeCatPayUrl(plan.key);
  return url ? { kind: "pay", url } : { kind: "reserve" };
}
