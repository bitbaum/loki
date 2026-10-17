import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * What each AI vendor last told us was left — the observed half of the budget.
 *
 * ── WHY THIS IS OBSERVED AND NOT POLLED ──────────────────────────────────────
 *
 * The obvious design is a cron that asks each provider how much quota remains.
 * That design reports a FULL TANK DURING AN OUTAGE. Measured on one live key,
 * within the same second:
 *
 *   GET  /api/v1/key        →  limit_remaining: null,  usage_daily: 0
 *   POST /chat/completions  →  429, x-ratelimit-remaining: 0 of 50,
 *                              "Rate limit exceeded: free-models-per-day"
 *
 * Both are OpenRouter's answers about the same account, and the account was
 * locked out. Its usage endpoint tracks money; free models cost nothing; the
 * limit that actually binds is a request count that endpoint never reports.
 *
 * So rows here are written from rate-limit headers on calls the app was making
 * anyway (ai-kit's `onQuota`). No extra request, and no quota spent to discover
 * how much quota is left.
 *
 * ── WHY LATEST-ONLY AND NOT AN EVENT LOG ─────────────────────────────────────
 *
 * The only question asked of this table is "what is left right now", on a
 * settings page and (later) in the router that picks a link. A row-per-response
 * log answers that with a window function over an ever-growing table; a rollup
 * answers it with a point read. Per-turn forensics already exist in the journal
 * line every turn writes.
 *
 * ── ABSENT IS A THIRD STATE ──────────────────────────────────────────────────
 *
 * A provider that has not been called today has NO ROW, and that is neither
 * empty nor full. Readers must render the absence as "unknown". Drawing it as
 * full repeats the bug above; drawing it as empty invents an outage. Nothing in
 * this table may be defaulted into existence.
 */
export const providerQuota = pgTable(
  "provider_quota",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Whose key this is. `"platform"` for the shared keys the operator pays;
     * a user id for a key that person brought (lib/agent/llm.ts records both,
     * and Settings → AI reads the person's rows to say what is left on it).
     *
     * NOT a nullable user_id, deliberately. Postgres treats NULLs as distinct
     * in a unique constraint, so a nullable column here would let the platform
     * accumulate one duplicate row per observation and the upsert would never
     * find its target — a rollup that silently becomes an append-only log.
     */
    keyOwner: text("key_owner").notNull().default("platform"),
    /** Vendor id as ai-kit names it: groq, openrouter, … */
    provider: text("provider").notNull(),
    /** Vendors meter per model (Groq gives each its own window), so it is part of the key. */
    model: text("model").notNull(),
    /** What is counted: "requests" or "tokens". */
    scope: text("scope").notNull(),
    /**
     * The period it refills over: "minute", "day", or "unknown".
     *
     * "unknown" is stored rather than guessed. The same header name counts a
     * day at one vendor and a minute at another, and a confident wrong window
     * turns "900 left today" into "900 left this minute".
     *
     * Called `window_kind`, because `window` is a RESERVED WORD in Postgres.
     * Drizzle and the migration both quote identifiers so the app was never at
     * risk — but every hand-written query would have needed `"window"` forever,
     * and the very first ad-hoc SELECT against this table failed with a syntax
     * error pointing at the wrong token. Renamed while it was a day old and
     * held one row; the cost only ever goes up.
     */
    windowKind: text("window_kind").notNull(),
    /** The ceiling, when the vendor stated one. */
    quotaLimit: integer("quota_limit"),
    /** What was left at `observedAt`. The number this table exists for. */
    remaining: integer("remaining").notNull(),
    /** When the counter refills. Null when the vendor did not say. */
    resetAt: timestamp("reset_at", { withTimezone: true }),
    /**
     * Where this came from: a header name, `"429"`, or `"preflight"`.
     *
     * `preflight` is not a measurement — it records that the link was SKIPPED
     * without being called, because the prompt exceeded its budget. That is a
     * different state from empty, and conflating the two would report a
     * perfectly healthy vendor as spent.
     */
    source: text("source").notNull(),
    /**
     * Why this row reads the way it does, in a sentence a person can act on.
     *
     * Exists because the first version of the settings page could show a number
     * but not a reason, and so told the operator that Groq was "waiting to be
     * measured" when it was in fact being skipped on every single turn for a
     * cause they could fix. A number with no reason is where an interface stops
     * being useful and starts being decoration.
     */
    note: text("note"),
    /** When the vendor said it. A reading is evidence about a moment. */
    observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // The upsert target. Without it, concurrent turns each insert and the
    // "latest" read becomes a guess between duplicate rows.
    //
    // A unique INDEX rather than a unique CONSTRAINT so the migration can carry
    // `IF NOT EXISTS`, which the box's forward-only applier requires to be
    // re-runnable. Postgres infers the same arbiter for ON CONFLICT either way.
    uniqueIndex("uq_provider_quota_counter").on(
      t.keyOwner,
      t.provider,
      t.model,
      t.scope,
      t.windowKind,
    ),
    // The settings page reads every counter for one owner at once.
    index("idx_provider_quota_owner").on(t.keyOwner),
  ],
);

export type ProviderQuota = typeof providerQuota.$inferSelect;
export type NewProviderQuota = typeof providerQuota.$inferInsert;

/** The owner value for the operator's own shared keys. */
export const PLATFORM_KEY_OWNER = "platform";
