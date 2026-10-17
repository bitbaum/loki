import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";
import type { Plan } from "./users";

/**
 * A person who asked for a paid plan before payments were open.
 *
 * Prices are set (config/plans.ts) but nothing can be charged until Loki's
 * company is registered and its OrangeCat passes exist. The pricing button
 * under a paid plan therefore RESERVES it: one row per person, the plan they
 * want, and nothing else. It is the demand signal the founder reads before
 * opening payments (System → Revenue), and the list told when they open.
 *
 * One row per user (unique): changing your mind replaces the plan; cancelling
 * deletes the row. Nothing here grants anything — `users.plan` is untouched.
 */
export const planReservations = pgTable(
  "plan_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    plan: text("plan").$type<Plan>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uq_plan_reservations_user").on(t.userId)],
);

export type PlanReservation = typeof planReservations.$inferSelect;
