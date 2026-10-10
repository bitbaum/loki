import { pgTable, uuid, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * The model a person chose BY HAND for one tier of turn — light, standard or
 * heavy (lib/models/auto-picks.ts). Auto computes a pick per tier from the
 * catalogue and the keys they hold; a row here replaces that pick and says so
 * on screen ("your choice"). Only hand choices are stored: a computed pick
 * follows the catalogue and would be stale the week it was written down.
 *
 * `vendor` and `model` name a key the person holds (user_model_keys); a row
 * whose key is gone is ignored on read, not an error.
 */
export const userModelTiers = pgTable(
  "user_model_tiers",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "economy" | "standard" | "frontier" — see ModelTier. */
    tier: text("tier").notNull(),
    vendor: text("vendor").notNull(),
    model: text("model").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tier] })],
);

export type UserModelTier = typeof userModelTiers.$inferSelect;
