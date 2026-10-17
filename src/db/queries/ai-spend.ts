import { db } from "@/db";
import { aiSpend } from "@/db/schema";
import { and, eq, gte, sql, count } from "drizzle-orm";
import { DAY_MS } from "@/lib/constants/time";
import { utcDayKey } from "@/lib/ai-budget/fair-share";

/**
 * The two reads and one write that fair-share rationing needs.
 *
 * Both reads run on EVERY chat turn, which is why the schema is a per-day
 * rollup rather than an event log — see db/schema/ai-spend.ts.
 */

export type DayUsage = {
  /** What this user has drawn today. */
  userSpentTokens: number;
  /**
   * Turns this user took today. Read from the same row as the tokens, so it
   * costs nothing, and it is what turns the per-answer constant in
   * lib/ai/quota-view.ts into a measurement: tokens ÷ turns is what THIS
   * person's answers actually cost today, which is the number "about N more
   * answers" should be built on.
   */
  userTurns: number;
  /**
   * Distinct users who drew today, INCLUDING this one even if they have not
   * spent yet. The divisor must count the requester or a newcomer is rationed
   * against a split that does not include them, briefly over-committing the day.
   */
  activeUsers: number;
};

/** Read today's usage for the fair-share decision. */
export async function getDayUsage(userId: string, now = new Date()): Promise<DayUsage> {
  const day = utcDayKey(now);

  const [mine, others] = await Promise.all([
    db
      .select({ tokens: aiSpend.tokens, turns: aiSpend.turns })
      .from(aiSpend)
      .where(and(eq(aiSpend.userId, userId), eq(aiSpend.day, day)))
      .limit(1),
    db.select({ n: count() }).from(aiSpend).where(eq(aiSpend.day, day)),
  ]);

  const userSpentTokens = mine[0]?.tokens ?? 0;
  const userTurns = mine[0]?.turns ?? 0;
  const spenders = others[0]?.n ?? 0;
  // A user with no row today is not yet counted in `spenders`, so add them.
  const activeUsers = mine.length > 0 ? spenders : spenders + 1;

  return { userSpentTokens, userTurns, activeUsers: Math.max(1, activeUsers) };
}

/**
 * Add a turn's actual cost to today's rollup.
 *
 * Upsert on (user, day) rather than read-modify-write: two turns landing at
 * once would otherwise both read the old total and the second would overwrite
 * the first, silently giving that user free budget. The increment happens
 * inside the database, where the unique index makes it atomic.
 */
export async function recordSpend(userId: string, tokens: number, now = new Date()): Promise<void> {
  const day = utcDayKey(now);
  const amount = Math.max(0, Math.round(tokens));

  await db
    .insert(aiSpend)
    .values({ userId, day, tokens: amount, turns: 1 })
    .onConflictDoUpdate({
      target: [aiSpend.userId, aiSpend.day],
      set: {
        tokens: sql`${aiSpend.tokens} + ${amount}`,
        turns: sql`${aiSpend.turns} + 1`,
        updatedAt: new Date(),
      },
    });
}

export type WeekSpend = {
  tokens: number;
  turns: number;
  /** Distinct UTC days with at least one turn, out of the last seven. */
  days: number;
};

/**
 * The last seven UTC days, today included, for the budget card's "this
 * week" line. A sum over at most seven rows — the rollup was built so this
 * is a point read and not a scan, and the week is the first question asked
 * of it beyond today.
 */
export async function getWeekSpend(userId: string, now = new Date()): Promise<WeekSpend> {
  const since = utcDayKey(new Date(now.getTime() - 6 * DAY_MS));
  const [row] = await db
    .select({
      tokens: sql<number>`coalesce(sum(${aiSpend.tokens}), 0)::int`,
      turns: sql<number>`coalesce(sum(${aiSpend.turns}), 0)::int`,
      days: sql<number>`count(*)::int`,
    })
    .from(aiSpend)
    .where(and(eq(aiSpend.userId, userId), gte(aiSpend.day, since)));
  return { tokens: row?.tokens ?? 0, turns: row?.turns ?? 0, days: row?.days ?? 0 };
}

/**
 * This UTC month's tokens, today included — what a paid plan's monthly
 * allowance is counted against (lib/ai-budget/plan-allowance.ts). At most 31
 * rows of the per-day rollup.
 */
export async function getMonthSpendTokens(userId: string, now = new Date()): Promise<number> {
  const since = `${utcDayKey(now).slice(0, 8)}01`;
  const [row] = await db
    .select({ tokens: sql<number>`coalesce(sum(${aiSpend.tokens}), 0)::int` })
    .from(aiSpend)
    .where(and(eq(aiSpend.userId, userId), gte(aiSpend.day, since)));
  return row?.tokens ?? 0;
}
