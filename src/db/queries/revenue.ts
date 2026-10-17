import { db } from "@/db";
import { users } from "@/db/schema";
import { ocBillingGrants } from "@/db/schema/billing-grants";
import { sql, and, ne, or, gt, isNull, desc, not } from "drizzle-orm";
import { countPlanReservations } from "@/db/queries/plan-reservations";
import { PRICING_PLANS, PRICING_CURRENCY } from "@/config/plans";
import type { Plan } from "@/db/schema/users";

/**
 * Platform revenue observability — the money-truth layer the business model
 * analysis (2026-07-19) flagged as the least-built part of the whole thesis.
 * If improvement loops are only honest when they touch settled money, the
 * operator needs one place that sums it. Read-only; founder-scoped in the UI.
 *
 * "Active paid" = a non-free plan whose pass hasn't lapsed AND that a settled
 * Bitcoin pass is paying for right now. A plan granted by hand (a trial, the
 * operator testing a tier) is on the same column but brings in nothing, so it
 * is counted apart as `granted` — once prices were set, counting it would have
 * shown revenue that was never paid.
 */
// A to-be-announced price (null) contributes 0 MRR — nothing is being charged.
const PRICE_BY_PLAN = Object.fromEntries(
  PRICING_PLANS.map((p) => [p.key, p.priceMonthly ?? 0]),
) as Record<Plan, number>;

export type RevenueByPlan = { plan: Plan; count: number; monthly: number };

export type RevenueSummary = {
  /** On a paid plan by hand, with no settled pass behind it. */
  granted: number;
  /** People waiting on each plan while payments are not open, and what they would pay. */
  reserved: { plan: Plan; count: number; monthly: number }[];
  currency: string;
  /** Monthly-recurring, normalized (annual plans shown per-month equivalent). */
  mrr: number;
  activePaid: number;
  freeUsers: number;
  byPlan: RevenueByPlan[];
  btcGrantCount: number;
  btcGrantTotal: number;
  recentGrants: {
    plan: Plan;
    amountBtc: string | null;
    createdAt: Date;
    expiresAt: Date;
  }[];
};

export async function getRevenueSummary(now = new Date()): Promise<RevenueSummary> {
  const activePaid = and(
    ne(users.plan, "free"),
    or(isNull(users.planExpiresAt), gt(users.planExpiresAt, now)),
  );

  // A settled pass in force: the only thing that makes a plan revenue.
  const paying = sql`exists (select 1 from ${ocBillingGrants} g where g.user_id = ${users.id} and g.expires_at > ${now} and nullif(g.amount_btc, '') is not null)`;

  const [planRows, grantedRow, freeRow, grantAgg, recent, reservations] = await Promise.all([
    db
      .select({ plan: users.plan, count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(activePaid, paying))
      .groupBy(users.plan),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(activePaid, not(paying))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(sql`${users.plan} = 'free'`),
    db
      .select({
        count: sql<number>`count(*)::int`,
        // amountBtc is text and may be "" (OC sends "" when amount is null).
        total: sql<string>`coalesce(sum(nullif(${ocBillingGrants.amountBtc}, '')::numeric), 0)`,
      })
      .from(ocBillingGrants),
    db
      .select({
        plan: ocBillingGrants.plan,
        amountBtc: ocBillingGrants.amountBtc,
        createdAt: ocBillingGrants.createdAt,
        expiresAt: ocBillingGrants.expiresAt,
      })
      .from(ocBillingGrants)
      .orderBy(desc(ocBillingGrants.createdAt))
      .limit(5),
    countPlanReservations().catch(() => []),
  ]);

  const byPlan: RevenueByPlan[] = planRows
    .map((r) => ({
      plan: r.plan,
      count: r.count,
      monthly: r.count * (PRICE_BY_PLAN[r.plan] ?? 0),
    }))
    .sort((a, b) => b.monthly - a.monthly);

  return {
    currency: PRICING_CURRENCY,
    mrr: byPlan.reduce((sum, r) => sum + r.monthly, 0),
    activePaid: byPlan.reduce((sum, r) => sum + r.count, 0),
    freeUsers: freeRow[0]?.count ?? 0,
    granted: grantedRow[0]?.count ?? 0,
    reserved: reservations
      .map((r) => ({ ...r, monthly: r.count * (PRICE_BY_PLAN[r.plan] ?? 0) }))
      .sort((a, b) => b.monthly - a.monthly),
    byPlan,
    btcGrantCount: grantAgg[0]?.count ?? 0,
    btcGrantTotal: Number(grantAgg[0]?.total ?? 0),
    recentGrants: recent,
  };
}
