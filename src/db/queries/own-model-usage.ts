import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { ownModelUsage } from "@/db/schema/own-model-usage";
import { utcDayKey } from "@/lib/ai-budget/fair-share";
import { DAY_MS } from "@/lib/constants/time";

/**
 * Add one call on the user's own key to today's bucket. Upsert, so two
 * concurrent turns add instead of racing. NEVER THROWS: a count that cannot
 * be written is a stale number; an exception here would fail an answer the
 * person is waiting for.
 */
export async function recordOwnUsage(input: {
  userId: string;
  vendor: string;
  model: string;
  tokens: number;
  now?: Date;
}): Promise<void> {
  const day = utcDayKey(input.now ?? new Date());
  const amount = Math.max(0, Math.round(input.tokens));
  try {
    await db
      .insert(ownModelUsage)
      .values({
        userId: input.userId,
        day,
        vendor: input.vendor,
        model: input.model,
        tokens: amount,
        calls: 1,
      })
      .onConflictDoUpdate({
        target: [
          ownModelUsage.userId,
          ownModelUsage.day,
          ownModelUsage.vendor,
          ownModelUsage.model,
        ],
        set: {
          tokens: sql`${ownModelUsage.tokens} + ${amount}`,
          calls: sql`${ownModelUsage.calls} + 1`,
          updatedAt: new Date(),
        },
      });
  } catch {
    // Swallowed on purpose — see the contract above.
  }
}

export type OwnUsageSummary = {
  vendor: string;
  tokensToday: number;
  callsToday: number;
  tokens30d: number;
  calls30d: number;
};

/** Per vendor: today and the last 30 days. Empty when the user's keys served nothing. */
export async function ownUsageByVendor(
  userId: string,
  now = new Date(),
): Promise<OwnUsageSummary[]> {
  const today = utcDayKey(now);
  const since = utcDayKey(new Date(now.getTime() - 30 * DAY_MS));
  const rows = await db
    .select({
      vendor: ownModelUsage.vendor,
      tokensToday: sql<number>`coalesce(sum(case when ${ownModelUsage.day} = ${today} then ${ownModelUsage.tokens} end), 0)::int`,
      callsToday: sql<number>`coalesce(sum(case when ${ownModelUsage.day} = ${today} then ${ownModelUsage.calls} end), 0)::int`,
      tokens30d: sql<number>`sum(${ownModelUsage.tokens})::int`,
      calls30d: sql<number>`sum(${ownModelUsage.calls})::int`,
    })
    .from(ownModelUsage)
    .where(and(eq(ownModelUsage.userId, userId), gte(ownModelUsage.day, since)))
    .groupBy(ownModelUsage.vendor);
  return rows;
}
