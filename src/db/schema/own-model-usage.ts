import { pgTable, uuid, integer, date, text, timestamp, unique, index } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * What a user's OWN keys spent, per vendor, per day.
 *
 * ── WHY NOT ai_usage OR ai_spend ─────────────────────────────────────────────
 * Both of those are Loki's meter for Loki's free pool: `ai_spend` rations a
 * user against the shared budget and `ai_usage` tells the operator where the
 * pool went. A turn on the user's own Anthropic key draws on neither — it is
 * their vendor's meter, their bill — so recording it there would ration a
 * person for money that was never Loki's and show the operator a vendor the
 * server does not even hold a key for. It was deliberately recorded nowhere
 * (llm.ts, "it is their vendor's meter, not Loki's"), which left the person
 * with no count of their own: nothing to compare one model against another
 * by, nothing to check a vendor's invoice against.
 *
 * So this is the third ledger, with the user as a column: WHOSE key, at WHICH
 * vendor, on WHICH model, how much. A rollup per (user, day, vendor, model)
 * for the same reason the other two are: the questions are "today" and
 * "this month", never "that call".
 */
export const ownModelUsage = pgTable(
  "own_model_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** UTC day, like ai_spend — vendors' own meters reset on UTC midnight. */
    day: date("day").notNull(),
    /** ai-kit vendor id: anthropic, xai, openrouter … */
    vendor: text("vendor").notNull(),
    model: text("model").notNull(),
    tokens: integer("tokens").notNull().default(0),
    calls: integer("calls").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("uq_own_model_usage_bucket").on(t.userId, t.day, t.vendor, t.model),
    index("idx_own_model_usage_user_day").on(t.userId, t.day),
  ],
);

export type OwnModelUsageRow = typeof ownModelUsage.$inferSelect;
