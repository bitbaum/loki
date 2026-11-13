import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";
import { agentTokens } from "./agent-tokens";

/**
 * A browser session opened with an agent's `ck_` token (lib/auth/token-session.ts).
 *
 * One row per exchange link. The link carries a random code whose SHA-256 is
 * `code_hash`; it opens once (`used_at`) before `expires_at`. Opening it
 * creates a short AccountKit session whose id lands in `session_id`, and that
 * session is read as the token's for as long as the row says so: when the
 * token is revoked `agent_token_id` goes NULL, and the session reads as signed
 * out on its next request.
 */
export const tokenSessions = pgTable(
  "token_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    codeHash: text("code_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentTokenId: uuid("agent_token_id").references(() => agentTokens.id, {
      onDelete: "set null",
    }),
    nextPath: text("next_path").notNull().default("/"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    sessionId: text("session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_token_sessions_code_hash").on(t.codeHash),
    uniqueIndex("uq_token_sessions_session_id").on(t.sessionId),
    index("idx_token_sessions_user_id").on(t.userId),
  ],
);

export type TokenSession = typeof tokenSessions.$inferSelect;
