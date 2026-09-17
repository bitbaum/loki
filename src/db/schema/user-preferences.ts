import { pgTable, uuid, text, date, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const userPreferences = pgTable(
  "user_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    // Home base — permanent location
    homeCity: text("home_city"),
    homeTimezone: text("home_timezone"),
    homeLocale: text("home_locale"),
    // Current location — overrides home while traveling
    currentCity: text("current_city"),
    currentTimezone: text("current_timezone"),
    currentCityUntil: date("current_city_until"),
    // Writing voice — free-text instruction layered on top of the house style
    // (docs/thoughts-style-guide.md) so AI-written content (Loki, essays) adopts
    // the user's preferred tone. Null = use the house default.
    writingVoice: text("writing_voice"),
    // Consent: may the fleet build its knowledge index (RAG embeddings) from the
    // user's data? Gates upsertKnowledgeBatch — the single write chokepoint.
    memoryEnabled: boolean("memory_enabled").notNull().default(true),
    // Action types the operator has approved IN ADVANCE, so Loki may carry them
    // out without a per-item tap. An authorisation record, so it is never
    // trusted as stored: lib/actions/standing-approval.ts filters it against a
    // hard-coded eligible set on read and re-checks the payload at decision
    // time. A value here that is not eligible authorises nothing.
    standingApprovals: text("standing_approvals")
      .array()
      .notNull()
      .default(sql`'{create_event}'`),
    /**
     * Which agent CLI to reach for first when the current one runs out of
     * quota — comma-separated agent ids, best first ("codex,claude,grok").
     *
     * Null is a real answer and not a missing one: it means the operator never
     * stated a preference, and the fleet's default order (AGENT_FALLBACK_ORDER)
     * applies. Stored as one ordered string rather than a rank-per-agent table
     * because the only question ever asked of it is "what is the whole order",
     * and a list is how an ordered list is spelled.
     *
     * Unknown ids are tolerated on read (parseProviderOrder drops them) so a
     * retired agent id in an old row degrades to "not ranked" instead of
     * breaking the chooser it feeds.
     */
    agentOrder: text("agent_order"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_user_preferences_user_id").on(t.userId)],
);

export type UserPreferencesRow = typeof userPreferences.$inferSelect;
export type NewUserPreferencesRow = typeof userPreferences.$inferInsert;
