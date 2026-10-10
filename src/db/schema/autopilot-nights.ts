import { pgTable, uuid, date, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";
import type { NightSummary } from "@/config/autopilot-night";

/**
 * What the autopilot night did, one row per (user, night). The morning note
 * on /feedback and the spend line in Settings read this; nothing else writes
 * it. A night that ran and did nothing still gets a row, so "nothing
 * happened" and "the timer never fired" stay distinguishable.
 */
export const autopilotNights = pgTable(
  "autopilot_nights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The UTC date the night ended on. */
    night: date("night").notNull(),
    summary: jsonb("summary").$type<NightSummary>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_autopilot_nights_user_night").on(t.userId, t.night)],
);

export type AutopilotNightRow = typeof autopilotNights.$inferSelect;
