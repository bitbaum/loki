import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { orchestrationRuns, pendingCommands, users } from "@/db/schema";
import { RUN_ENGINE } from "@/lib/build-engine/allowance";

/** The first instant of `now`'s UTC month. */
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const engineIs = (engine: string) => sql`${orchestrationRuns.payload}->>'engine' = ${engine}`;

/** Runs this account opened on `engine`, since `since` (ever, when omitted). */
export async function countRunsOnEngine(
  userId: string,
  engine: string,
  since?: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orchestrationRuns)
    .where(
      and(
        eq(orchestrationRuns.userId, userId),
        engineIs(engine),
        ...(since ? [gte(orchestrationRuns.startedAt, since)] : []),
      ),
    );
  return row?.n ?? 0;
}

/** What welcome builds cost Loki this month across every account, in USD at list rates. */
export async function welcomeSpendUsdThisMonth(now = new Date()): Promise<number> {
  const [row] = await db
    .select({ usd: sql<number>`coalesce(sum(${orchestrationRuns.costUsd}), 0)::float` })
    .from(orchestrationRuns)
    .where(
      and(engineIs(RUN_ENGINE.LOKI_WELCOME), gte(orchestrationRuns.startedAt, monthStart(now))),
    );
  return row?.usd ?? 0;
}

/** Builds and their recorded cost per account this month, most first — the Capacity reading. */
export async function buildsByAccountThisMonth(now = new Date(), limit = 12) {
  return db
    .select({
      userId: orchestrationRuns.userId,
      label: sql<string | null>`coalesce(${users.username}, ${users.name}, ${users.email})`,
      runs: sql<number>`count(*)::int`,
      onLoki: sql<number>`count(*) filter (where ${orchestrationRuns.payload}->>'engine' in (${RUN_ENGINE.LOKI_WELCOME}, ${RUN_ENGINE.LOKI_PLAN}))::int`,
      tokens: sql<number>`coalesce(sum(coalesce(${orchestrationRuns.tokensIn}, 0) + coalesce(${orchestrationRuns.tokensOut}, 0)), 0)::float`,
      costUsd: sql<number>`coalesce(sum(${orchestrationRuns.costUsd}), 0)::float`,
    })
    .from(orchestrationRuns)
    .innerJoin(users, eq(users.id, orchestrationRuns.userId))
    .where(gte(orchestrationRuns.startedAt, monthStart(now)))
    .groupBy(orchestrationRuns.userId, users.username, users.name, users.email)
    .orderBy(sql`count(*) desc`)
    .limit(limit);
}

/**
 * How long work waited for a builder in the last day, per channel: the
 * median and the worst of claimed_at − created_at. Unclaimed rows older than
 * twenty minutes are purged, so a wait past that shows as the worst here
 * and as a stall on Control, never as a bigger number.
 */
export async function queueWaitByChannel(now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  return db
    .select({
      channel: sql<string | null>`${pendingCommands.payload}->>'channel'`,
      claimed: sql<number>`count(*)::int`,
      medianSeconds: sql<
        number | null
      >`extract(epoch from percentile_cont(0.5) within group (order by (${pendingCommands.claimedAt} - ${pendingCommands.createdAt})))`,
      worstSeconds: sql<
        number | null
      >`extract(epoch from max(${pendingCommands.claimedAt} - ${pendingCommands.createdAt}))`,
    })
    .from(pendingCommands)
    .where(and(isNotNull(pendingCommands.claimedAt), gte(pendingCommands.createdAt, since)))
    .groupBy(sql`${pendingCommands.payload}->>'channel'`);
}
