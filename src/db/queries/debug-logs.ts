import { db } from "@/db";
import { debugLogs, type NewDebugLog } from "@/db/schema/debug-logs";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { DAY_MS } from "@/lib/constants/time";

/**
 * Fire-and-forget logger. Never throws — a telemetry failure must not break
 * the user-facing operation it was observing. Returns the insert promise so
 * tests can await it, but callers should NOT await this in request handlers.
 */
export function logDebug(entry: Omit<NewDebugLog, "id" | "createdAt">): Promise<unknown> {
  return db
    .insert(debugLogs)
    .values(entry)
    .catch((err) => {
      // Telemetry failed (e.g. Postgres down — the one failure you most need
      // recorded). Fall back to stderr so journald still captures it, and include
      // meta: it holds the stack/digest, so dropping it would be a partial
      // blackout exactly when the DB sink is unavailable.
      console.error("[debug-logs] insert failed:", err, "for entry:", {
        source: entry.source,
        level: entry.level,
        message: entry.message,
        meta: entry.meta ?? null,
      });
    });
}

/** Most-recent N debug log entries, newest first. UI helper for a future admin view. */
export async function getRecentDebugLogs(limit = 50) {
  return db.select().from(debugLogs).orderBy(desc(debugLogs.createdAt)).limit(limit);
}

/** Most-recent N errors and warnings, newest first — the heartbeats left out. */
export async function getRecentProblemLogs(limit = 10) {
  return db
    .select()
    .from(debugLogs)
    .where(inArray(debugLogs.level, ["error", "warn"]))
    .orderBy(desc(debugLogs.createdAt))
    .limit(limit);
}

/**
 * Prune old debug log rows so the table doesn't grow unbounded. Two
 * thresholds because error rows are more valuable for postmortems and
 * deserve a longer retention window.
 *
 * Default: warn/info → 30 days, error → 90 days.
 *
 * Returns the count of rows deleted (Postgres rowCount via `.rowCount` is
 * surfaced by postgres-js as the array length of the returning() result,
 * which we use here for portability).
 */
export async function pruneDebugLogs({
  nonErrorOlderThanDays = 30,
  errorOlderThanDays = 90,
}: { nonErrorOlderThanDays?: number; errorOlderThanDays?: number } = {}): Promise<number> {
  const now = Date.now();
  const nonErrorCutoff = new Date(now - nonErrorOlderThanDays * DAY_MS);
  const errorCutoff = new Date(now - errorOlderThanDays * DAY_MS);

  const deleted = await db
    .delete(debugLogs)
    .where(
      or(
        and(sql`${debugLogs.level} <> 'error'`, lt(debugLogs.createdAt, nonErrorCutoff)),
        and(eq(debugLogs.level, "error"), lt(debugLogs.createdAt, errorCutoff)),
      ),
    )
    .returning({ id: debugLogs.id });

  return deleted.length;
}
