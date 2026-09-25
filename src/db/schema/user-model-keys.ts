import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * The model a user brought: their own API key at a vendor, and the model they
 * chose there. With it, Loki's chat runs on that model — their vendor account,
 * their bill — instead of the shared, rationed free chain.
 *
 * One row per user. The key is stored SEALED (`@bitbaum/ai-kit/seal`,
 * AES-256-GCM with the app's `BYOK_SEAL_SECRET`), so the database alone cannot
 * read it; `key_hint` ("…abcd") is the only part ever shown back. The vendor is
 * an id from ai-kit's closed list, never a URL: the server sends this key to
 * the host that id names, and nowhere else.
 *
 * This is for API keys. A Claude or ChatGPT *subscription* is not stored here
 * and never will be — signing in to those happens in the agent's own login
 * flow, and Loki does not hold those credentials.
 */
export const userModelKeys = pgTable("user_model_keys", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** An id from ai-kit's BYOK_VENDORS ("anthropic", "openrouter", …). */
  vendor: text("vendor").notNull(),
  /** The model id at that vendor the user picked. */
  model: text("model").notNull(),
  /** `iv:tag:ciphertext` from sealSecret(..., "byok"). Never returned by an API. */
  sealedKey: text("sealed_key").notNull(),
  /** "…abcd" — the last four characters, for recognising which key this is. */
  keyHint: text("key_hint").notNull(),
  /** When the vendor last accepted this key (probed on save). */
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type UserModelKey = typeof userModelKeys.$inferSelect;
