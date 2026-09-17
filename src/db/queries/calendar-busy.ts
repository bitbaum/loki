import { db } from "@/db";
import { calendarBusy, type NewCalendarBusyRow } from "@/db/schema";
import { and, eq, gte, lt, lte, desc, sql } from "drizzle-orm";
import type { BusyBlock } from "@/lib/calendar/busy";

/**
 * Replace the mirror for one time window.
 *
 * REPLACE, NOT MERGE — and the delete is the important half. An event the
 * operator cancelled in Google simply stops appearing in what the box sends; if
 * we only upserted, it would sit here forever and produce a phantom clash on a
 * slot that is actually free. A warning that cries wolf gets ignored, which
 * costs more than never having warned.
 *
 * Scoped to the window the caller actually looked at: a sync covering the next
 * 30 days must not delete something already mirrored for next year.
 *
 * One transaction, so a reader never sees the gap between the delete and the
 * insert — mid-sync, a conflict check would otherwise find an empty calendar
 * and cheerfully report "clear".
 */
export async function replaceBusyWindow(
  userId: string,
  windowStart: Date,
  windowEnd: Date,
  blocks: Array<{
    eventId: string;
    summary: string | null;
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
  }>,
  syncedAt: Date = new Date(),
): Promise<{ removed: number; written: number }> {
  return db.transaction(async (tx) => {
    // Anything that STARTS inside the window is the window's business. An event
    // that began before it and runs in is owned by an earlier sync.
    const removed = await tx
      .delete(calendarBusy)
      .where(
        and(
          eq(calendarBusy.userId, userId),
          gte(calendarBusy.startsAt, windowStart),
          lt(calendarBusy.startsAt, windowEnd),
        ),
      )
      .returning({ id: calendarBusy.id });

    if (blocks.length === 0) return { removed: removed.length, written: 0 };

    const values: NewCalendarBusyRow[] = blocks.map((b) => ({
      userId,
      eventId: b.eventId,
      summary: b.summary,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      allDay: b.allDay,
      syncedAt,
    }));

    // onConflictDoUpdate, not DoNothing: the same event id can legitimately
    // reappear having MOVED, and the whole point is to mirror where it is now.
    const written = await tx
      .insert(calendarBusy)
      .values(values)
      .onConflictDoUpdate({
        target: [calendarBusy.userId, calendarBusy.eventId],
        set: {
          summary: sql`excluded.summary`,
          startsAt: sql`excluded.starts_at`,
          endsAt: sql`excluded.ends_at`,
          allDay: sql`excluded.all_day`,
          syncedAt: sql`excluded.synced_at`,
        },
      })
      .returning({ id: calendarBusy.id });

    return { removed: removed.length, written: written.length };
  });
}

/**
 * Blocks overlapping [start, end), plus how fresh the mirror is.
 *
 * `syncedAt` is returned even when no block matches — that is the entire reason
 * this returns a pair rather than an array. "Nothing overlaps" and "we have no
 * idea" look identical in an empty list, and the caller must be able to tell
 * them apart (lib/calendar/busy.ts).
 */
export async function getBusyAround(
  userId: string,
  start: Date,
  end: Date,
): Promise<{ blocks: BusyBlock[]; syncedAt: Date | null }> {
  const [rows, freshest] = await Promise.all([
    db
      .select({
        summary: calendarBusy.summary,
        startsAt: calendarBusy.startsAt,
        endsAt: calendarBusy.endsAt,
        allDay: calendarBusy.allDay,
      })
      .from(calendarBusy)
      .where(
        and(
          eq(calendarBusy.userId, userId),
          // Overlap, expressed the SQL way: starts before our end AND ends
          // after our start. Half-open on both sides, so back-to-back blocks
          // are not collisions.
          lt(calendarBusy.startsAt, end),
          sql`${calendarBusy.endsAt} > ${start}`,
        ),
      )
      .orderBy(calendarBusy.startsAt),
    db
      .select({ syncedAt: calendarBusy.syncedAt })
      .from(calendarBusy)
      .where(eq(calendarBusy.userId, userId))
      .orderBy(desc(calendarBusy.syncedAt))
      .limit(1),
  ]);

  return {
    blocks: rows.map((r) => ({
      summary: r.summary,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      allDay: r.allDay,
    })),
    syncedAt: freshest[0]?.syncedAt ?? null,
  };
}

/** Drop mirrored blocks that are entirely in the past — the cache is about what is ahead. */
export async function pruneBusyBefore(cutoff: Date): Promise<number> {
  const gone = await db
    .delete(calendarBusy)
    .where(lte(calendarBusy.endsAt, cutoff))
    .returning({ id: calendarBusy.id });
  return gone.length;
}
