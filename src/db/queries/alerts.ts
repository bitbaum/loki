import { db } from "@/db";
import { alerts } from "@/db/schema";
import type { Alert, NewAlert } from "@/db/schema/alerts";
import { eq, and, desc, inArray, notInArray } from "drizzle-orm";
import { ALERT_TYPE_IDS } from "@/config/alert-types";
import { isAlertCurrent } from "@/lib/alerts/relevance";

/** Insert an alert only if the user has no CURRENT active alert of the same
 *  type — so a periodic checker (e.g. runner-stall) raises the flag once and
 *  stops spamming. Returns the new row, or null when a current one existed.
 *
 *  An open alert that has outlived its relevance (lib/alerts/relevance) no
 *  longer blocks: it is closed and the new occurrence raised fresh. Deduping
 *  against ANY open row meant one alert nobody dismissed swallowed every later
 *  stall of the same kind — the bell showed a 3-week-old one and never the
 *  stall happening now. */
export async function insertActiveAlertOnce(alert: NewAlert): Promise<Alert | null> {
  const open = await db
    .select({
      id: alerts.id,
      type: alerts.type,
      severity: alerts.severity,
      createdAt: alerts.createdAt,
    })
    .from(alerts)
    .where(
      and(
        eq(alerts.userId, alert.userId),
        eq(alerts.type, alert.type),
        eq(alerts.dismissed, false),
      ),
    );
  const now = Date.now();
  if (open.some((row) => isAlertCurrent(row, now))) return null;
  if (open.length > 0) {
    await db
      .update(alerts)
      .set({ dismissed: true, dismissedAt: new Date() })
      .where(
        inArray(
          alerts.id,
          open.map((row) => row.id),
        ),
      );
  }
  const [row] = await db.insert(alerts).values(alert).returning();
  return row;
}

/**
 * Raise-or-refresh: keep exactly one active alert of `type` per user, and keep
 * its wording current. `created` is true only when the flag went up — callers
 * use it to fire the out-of-band ping (Telegram) exactly once per episode
 * instead of on every tick. Refreshing an existing alert deliberately does NOT
 * count as creation: the count changing from 2 to 3 is not a new event.
 */
export async function refreshOrInsertActiveAlert(
  alert: NewAlert,
  opts: {
    /**
     * Given the open alert's metadata, is this a NEW episode — the thing got
     * worse (more items waiting than when it was raised)? Then the alert is
     * dated now, so it is news again (lib/alerts/relevance), instead of
     * keeping the date it first went up. Without it a summary first raised
     * 28 days ago said "28d ago" over a count that grew yesterday.
     */
    renew?: (previous: Record<string, unknown> | null) => boolean;
  } = {},
): Promise<{ alert: Alert | null; created: boolean }> {
  const [existing] = await db
    .select({ id: alerts.id, metadata: alerts.metadata })
    .from(alerts)
    .where(
      and(
        eq(alerts.userId, alert.userId),
        eq(alerts.type, alert.type),
        eq(alerts.dismissed, false),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(alerts)
      .set({
        severity: alert.severity,
        title: alert.title,
        description: alert.description,
        metadata: alert.metadata,
        actionUrl: alert.actionUrl,
        ...(opts.renew?.(existing.metadata ?? null) ? { createdAt: new Date() } : {}),
      })
      .where(eq(alerts.id, existing.id))
      .returning();
    return { alert: updated ?? null, created: false };
  }

  const [row] = await db.insert(alerts).values(alert).returning();
  return { alert: row ?? null, created: true };
}

/**
 * Clear alerts whose TYPE no code can raise any more.
 *
 * When a feature is retired, its alert rows are not. Measured 2026-08-26: four
 * of ten open alerts — `bill_due`, `stale_relationship`, `overdue_commitment`,
 * `stalled_goal` — were raised between May and June by producers that no longer
 * exist. Nothing could refresh them and nothing could auto-resolve them, so
 * they sat for up to 108 days at the top of the surface that also carries "a
 * telemetry sensor is dead" and "a machine is running old code".
 *
 * Safe by construction, and that is the whole argument for doing it
 * automatically: a type absent from ALERT_TYPES has no producer, so no live
 * condition can be hidden by clearing it. The only thing being thrown away is
 * a claim nothing is willing to make any more.
 *
 * Deletion as a consequence of the producer being gone, rather than an act of
 * will by whoever remembers. Returns the types cleared, so the caller can say
 * what happened instead of tidying up in silence.
 */
export async function dismissUnregisteredAlerts(): Promise<{ type: string; count: number }[]> {
  const cleared = await db
    .update(alerts)
    .set({ dismissed: true, dismissedAt: new Date() })
    .where(and(eq(alerts.dismissed, false), notInArray(alerts.type, ALERT_TYPE_IDS)))
    .returning({ type: alerts.type });

  const byType = new Map<string, number>();
  for (const row of cleared) byType.set(row.type, (byType.get(row.type) ?? 0) + 1);
  return [...byType].map(([type, count]) => ({ type, count }));
}

/** Open alerts grouped by type — what the surface currently claims, for a
 *  sweeper that wants to report the state it left behind. */
export async function countOpenAlertsByType(): Promise<{ type: string; count: number }[]> {
  const rows = await db
    .select({ type: alerts.type })
    .from(alerts)
    .where(eq(alerts.dismissed, false));
  const byType = new Map<string, number>();
  for (const row of rows) byType.set(row.type, (byType.get(row.type) ?? 0) + 1);
  return [...byType].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
}

/**
 * Auto-resolve: clear this user's active alerts of `type` because the condition
 * that raised them is gone. Without this an alert stays up until dismissed by
 * hand, and — because raise-once dedupes against it — the NEXT occurrence is
 * silently swallowed. A flag that cannot fall is a flag that only works once.
 * Returns how many were cleared.
 */
export async function dismissActiveAlertsByType(userId: string, type: string): Promise<number> {
  const cleared = await db
    .update(alerts)
    .set({ dismissed: true, dismissedAt: new Date() })
    .where(and(eq(alerts.userId, userId), eq(alerts.type, type), eq(alerts.dismissed, false)))
    .returning({ id: alerts.id });
  return cleared.length;
}

/** Users currently flagged with an active alert of `type` — the set a sweeper
 *  must consider for auto-resolution, including users its main query no longer
 *  returns (that absence is exactly what "resolved" looks like). */
export async function getUserIdsWithActiveAlertType(type: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: alerts.userId })
    .from(alerts)
    .where(and(eq(alerts.type, type), eq(alerts.dismissed, false)));
  return rows.map((r) => r.userId);
}

export async function getActiveAlerts(userId: string) {
  return db
    .select()
    .from(alerts)
    .where(and(eq(alerts.userId, userId), eq(alerts.dismissed, false)))
    .orderBy(desc(alerts.createdAt))
    .limit(20);
}

export async function dismissAlert(id: string, userId: string) {
  return db
    .update(alerts)
    .set({ dismissed: true, dismissedAt: new Date() })
    .where(and(eq(alerts.id, id), eq(alerts.userId, userId)))
    .returning();
}
