import { pgTable, uuid, text, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * A read-only mirror of the operator's calendar — what is occupied, and what
 * it is called. Nothing else.
 *
 * The calendar itself is behind `gog`, authenticated only on the operator's
 * machine, so the cloud control plane cannot see it (api/calendar returns
 * `runtimeOnly: true` there). That is fine for displaying a day, and not fine
 * for the approval card, which asks "shall I book this?" without being able to
 * check whether the slot is free. On 2026-09-17 a proposal landed on top of an
 * existing meeting and the card said nothing.
 *
 * The box pushes a rolling window here (home/calendar-drain.ts → POST
 * /api/calendar/busy) and the cloud reads it to warn BEFORE a decision.
 *
 * It is a CACHE. Google is authoritative, `gog` is the only writer, and every
 * read must account for the mirror being stale — see lib/calendar/busy.ts,
 * where "we could not check" is a distinct answer from "you are free".
 */
export const calendarBusy = pgTable(
  "calendar_busy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Google's event id — the dedupe key within a user. */
    eventId: text("event_id").notNull(),
    /** What it is called, so a warning can name the thing it collides with. */
    summary: text("summary"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    /** Exclusive, matching Google's own all-day convention. */
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    /**
     * When this row was last confirmed present in the real calendar.
     *
     * Load-bearing, not bookkeeping: an offline box leaves the mirror stale,
     * and a stale empty window looks exactly like a free afternoon. Readers use
     * this to refuse to answer rather than answer wrongly.
     */
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_calendar_busy_user_window").on(t.userId, t.startsAt, t.endsAt),
    uniqueIndex("idx_calendar_busy_user_event").on(t.userId, t.eventId),
  ],
);

export type CalendarBusyRow = typeof calendarBusy.$inferSelect;
export type NewCalendarBusyRow = typeof calendarBusy.$inferInsert;
