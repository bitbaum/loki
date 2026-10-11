import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import type { SuggestionDecision } from "@/lib/suggestions/types";

/**
 * What the person decided about a suggestion on /suggestions.
 *
 * A suggestion has no row of its own — it is derived from the records behind
 * it on every load (lib/suggestions). What needs remembering is only the
 * person's answer to it: "Do it" or "Not now", when. That is enough to keep
 * it off the board for a while (lib/suggestions/board.ts) and to count, from
 * records rather than guesses, how much of what Loki offered actually got
 * taken up — the one number the page shows about itself.
 *
 * Append-only by use: an undo deletes the row, nothing updates one.
 */
export const suggestionDecisions = pgTable(
  "suggestion_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The suggestion's stable id, e.g. "fix:sink" — see lib/build-suggestions/rank.ts. */
    suggestionId: text("suggestion_id").notNull(),
    decision: text("decision").$type<SuggestionDecision>().notNull(),
    /** The label as shown when they decided, so the history reads back as sentences. */
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_suggestion_decisions_user_created").on(t.userId, t.createdAt)],
);

export type SuggestionDecisionRow = typeof suggestionDecisions.$inferSelect;
export type NewSuggestionDecisionRow = typeof suggestionDecisions.$inferInsert;
