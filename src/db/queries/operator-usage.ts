import { db } from "@/db";
import { operatorUsageEvents, type NewOperatorUsageEvent } from "@/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import { USAGE_WINDOW_DAYS } from "@/config/usage-surfaces";

export type UsageEventInput = Pick<
  NewOperatorUsageEvent,
  "surface" | "action" | "target" | "path" | "meta"
>;

/** Append events for one operator. Returns how many rows were written. */
export async function recordUsageEvents(
  userId: string,
  events: UsageEventInput[],
): Promise<number> {
  if (events.length === 0) return 0;
  const rows = await db
    .insert(operatorUsageEvents)
    .values(events.map((e) => ({ ...e, userId })))
    .returning({ id: operatorUsageEvents.id });
  return rows.length;
}

/**
 * The operator's events inside a window, newest first. Bounded: a summary over
 * two weeks of one person's taps is hundreds of rows at most, and a cap keeps
 * a runaway client from turning a seed fetch into a table scan.
 */
export async function listUsageEvents(
  userId: string,
  opts: { surface?: string; sinceDays?: number; limit?: number } = {},
) {
  const sinceDays = opts.sinceDays ?? USAGE_WINDOW_DAYS;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const where = [eq(operatorUsageEvents.userId, userId), gte(operatorUsageEvents.createdAt, since)];
  if (opts.surface) where.push(eq(operatorUsageEvents.surface, opts.surface));
  return db
    .select()
    .from(operatorUsageEvents)
    .where(and(...where))
    .orderBy(desc(operatorUsageEvents.createdAt))
    .limit(opts.limit ?? 2_000);
}
