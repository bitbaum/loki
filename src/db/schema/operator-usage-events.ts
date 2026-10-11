import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * What the OPERATOR does with a surface Loki built for them: shown, tapped,
 * rotated, dismissed. One row per event, append-only.
 *
 * Deliberately apart from `control_audit_events` (what the operator decided on
 * /control — commands, not clicks) and from `site_feedback` (what VISITORS say
 * on customer sites). This is the record a ship report could not give on
 * 2026-10-11: whether anyone used the thing that was shipped. Surfaces and the
 * actions each allows are SSOT in src/config/usage-surfaces.ts; the API
 * refuses rows that name anything else.
 *
 * `target` is an id or a kind (e.g. `fix:sink`), never text the operator
 * typed. `meta` carries what a shown row offered (kinds, ids, offset), so a
 * summary can say "demand was offered 9 times and never tapped".
 */
export const operatorUsageEvents = pgTable(
  "operator_usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    surface: text("surface").notNull(),
    action: text("action").notNull(),
    target: text("target"),
    path: text("path"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_operator_usage_user_surface_time").on(table.userId, table.surface, table.createdAt),
  ],
);

export type OperatorUsageEvent = typeof operatorUsageEvents.$inferSelect;
export type NewOperatorUsageEvent = typeof operatorUsageEvents.$inferInsert;
