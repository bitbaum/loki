import { db } from "@/db";
import { alerts } from "@/db/schema";
import type { Alert } from "@/db/schema/alerts";
import { and, desc, eq, sql } from "drizzle-orm";

/**
 * Storage for the notify gateway (lib/notify/deliver.ts). A notice is an
 * `alerts` row — so everything any bot said is in the list on /today or
 * /system whether or not it reached the phone — with the gateway's own facts in
 * metadata: source, key, how many times it was delivered and when.
 */
export type NoticeMeta = {
  source: string;
  key?: string;
  urgency?: string;
  actions?: { label: string; url: string }[];
  /** Times this key went to Telegram. */
  delivered?: number;
  /** Epoch ms of the last delivery to Telegram. */
  deliveredAt?: number;
  /** Times the same key was raised at all (including held ones). */
  seen?: number;
  /** Why the last occurrence did not go out, when it did not. */
  heldBecause?: string;
};

/** The open row for this user/type/key, if any. */
export async function findOpenNotice(
  userId: string,
  type: string,
  key: string,
): Promise<Alert | null> {
  const [row] = await db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.userId, userId),
        eq(alerts.type, type),
        eq(alerts.dismissed, false),
        sql`${alerts.metadata}->>'key' = ${key}`,
      ),
    )
    .orderBy(desc(alerts.createdAt))
    .limit(1);
  return row ?? null;
}

/** Deliveries to Telegram since `since`, optionally from one source. */
export async function countDeliveries(
  userId: string,
  since: Date,
  source?: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(alerts)
    .where(
      and(
        eq(alerts.userId, userId),
        sql`(${alerts.metadata}->>'deliveredAt')::bigint >= ${since.getTime()}`,
        source ? sql`${alerts.metadata}->>'source' = ${source}` : undefined,
      ),
    );
  return row?.n ?? 0;
}

export async function insertNotice(row: typeof alerts.$inferInsert): Promise<Alert | null> {
  const [created] = await db.insert(alerts).values(row).returning();
  return created ?? null;
}

export async function updateNotice(
  id: string,
  patch: Partial<Pick<Alert, "title" | "description" | "severity" | "actionUrl" | "metadata">>,
): Promise<void> {
  await db.update(alerts).set(patch).where(eq(alerts.id, id));
}

/** Close the open notice for a key — the incident is over, the next one is news. */
export async function closeNotice(userId: string, type: string, key: string): Promise<number> {
  const rows = await db
    .update(alerts)
    .set({ dismissed: true, dismissedAt: new Date() })
    .where(
      and(
        eq(alerts.userId, userId),
        eq(alerts.type, type),
        eq(alerts.dismissed, false),
        sql`${alerts.metadata}->>'key' = ${key}`,
      ),
    )
    .returning({ id: alerts.id });
  return rows.length;
}
