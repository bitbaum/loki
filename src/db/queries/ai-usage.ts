import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage } from "@/db/schema/ai-usage";
import { utcDayKey } from "@/lib/ai-budget/fair-share";

/**
 * Record what a completed call cost, and who asked for it.
 *
 * Deliberately mirrors `recordSpend`: an upsert onto one bucket per
 * (day, provider, model, feature), so concurrent calls add rather than race.
 *
 * NEVER THROWS. This is telemetry hanging off a call the operator is waiting
 * for. A ledger that cannot be written is a stale page, which is survivable; an
 * exception here would turn a good answer into a failed one and demote a
 * working vendor off the chain, which is not. Same rule as `record-quota.ts`.
 */
export async function recordUsage(input: {
  provider: string;
  model: string;
  feature: string;
  tokens: number;
  now?: Date;
}): Promise<void> {
  const day = utcDayKey(input.now ?? new Date());
  const amount = Math.max(0, Math.round(input.tokens));
  try {
    await db
      .insert(aiUsage)
      .values({
        day,
        provider: input.provider,
        model: input.model,
        feature: input.feature,
        tokens: amount,
        calls: 1,
      })
      .onConflictDoUpdate({
        target: [aiUsage.day, aiUsage.provider, aiUsage.model, aiUsage.feature],
        set: {
          tokens: sql`${aiUsage.tokens} + ${amount}`,
          calls: sql`${aiUsage.calls} + 1`,
          updatedAt: new Date(),
        },
      });
  } catch {
    // Swallowed on purpose — see the contract above.
  }
}

/**
 * The day's totals per FEATURE, which is the question the capacity page asks:
 * "where did today go?" Aggregated in the database rather than in the route, so
 * adding a provider does not change the shape of the answer.
 */
export async function usageByFeature(
  now = new Date(),
): Promise<Array<{ feature: string; tokens: number; calls: number }>> {
  const rows = await db
    .select({
      feature: aiUsage.feature,
      tokens: sql<number>`sum(${aiUsage.tokens})::int`,
      calls: sql<number>`sum(${aiUsage.calls})::int`,
    })
    .from(aiUsage)
    .where(and(eq(aiUsage.day, utcDayKey(now))))
    .groupBy(aiUsage.feature)
    .orderBy(desc(sql`sum(${aiUsage.tokens})`));
  return rows;
}

/**
 * The day's totals per PROVIDER — the evidence that a vendor SERVED, even when
 * it discloses no limits.
 *
 * Gemini publishes no rate-limit headers at all, so it can never appear in
 * `provider_quota`. Without this, the capacity page said "configured, but it
 * has not served an answer yet" about the vendor answering most of the traffic,
 * and would have said it forever — the exact false claim this surface exists to
 * stop. Spend is the second witness: it knows a call happened even when the
 * vendor says nothing about what is left.
 */
export async function usageByProvider(
  now = new Date(),
): Promise<Array<{ provider: string; tokens: number; calls: number }>> {
  return db
    .select({
      provider: aiUsage.provider,
      tokens: sql<number>`sum(${aiUsage.tokens})::int`,
      calls: sql<number>`sum(${aiUsage.calls})::int`,
    })
    .from(aiUsage)
    .where(eq(aiUsage.day, utcDayKey(now)))
    .groupBy(aiUsage.provider);
}
