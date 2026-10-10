import { pgTable, uuid, text, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * The model a user brought: their own API key at a vendor, and the model they
 * chose there. With it, Loki's chat runs on that model — their vendor account,
 * their bill — instead of the shared, rationed free chain.
 *
 * One row per (user, vendor): a person may hold several — Anthropic for
 * thinking, Groq for speed, OpenRouter for everything else — and `position`
 * orders them into their own chain, the first being what Loki thinks with and
 * the rest the fallback when it is busy or out of credit. Until 2026-10-09
 * this was one row per user, which made "add a key for the model that is not
 * available" mean "replace the key you had". The key is stored SEALED (`@bitbaum/ai-kit/seal`,
 * AES-256-GCM with the app's `BYOK_SEAL_SECRET`), so the database alone cannot
 * read it; `key_hint` ("…abcd") is the only part ever shown back. The vendor is
 * an id from Loki's closed list (config/model-vendors.ts), and the server
 * sends this key to the host that id names — except `custom`, whose host is
 * the row's `base_url`, gated by lib/models/endpoint-guard.ts. A keyless
 * endpoint seals the empty string: the column stays NOT NULL and the walker
 * sends no Authorization header for it.
 *
 * This is for API keys. A Claude or ChatGPT *subscription* is not stored here
 * and never will be — signing in to those happens in the agent's own login
 * flow, and Loki does not hold those credentials.
 */
export const userModelKeys = pgTable(
  "user_model_keys",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** An id from Loki's VENDORS (config/model-vendors.ts): ai-kit's ten, the extras, or "custom". */
    vendor: text("vendor").notNull(),
    /** Order in the user's own chain; 0 is what Loki thinks with first. */
    position: integer("position").notNull().default(0),
    /** The model id at that vendor the user picked. */
    model: text("model").notNull(),
    /**
     * Only for `vendor = 'custom'` — the person's own OpenAI-compatible host,
     * stored as lib/models/endpoint-guard.ts accepted it and re-checked at
     * every connection. Null for every other vendor, whose host is the
     * table's (config/model-vendors.ts) and never the row's; getOwnModels
     * ignores this column for them.
     */
    baseUrl: text("base_url"),
    /** A name the person gave their endpoint ("MacBook Ollama"). Only for `custom`. */
    label: text("label"),
    /** `iv:tag:ciphertext` from sealSecret(..., "byok"). Never returned by an API. */
    sealedKey: text("sealed_key").notNull(),
    /** "…abcd" — the last four characters, for recognising which key this is. */
    keyHint: text("key_hint").notNull(),
    /** When the vendor last accepted this key (probed on save). */
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.vendor] })],
);

export type UserModelKey = typeof userModelKeys.$inferSelect;
