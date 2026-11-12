import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { orgs } from "./orgs";

export const agentTokens = pgTable(
  "agent_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(), // ck_<32 random bytes hex>
    label: text("label").notNull(), // e.g. "macbook-pro" or "hetzner-vps"
    /**
     * What the token may do. "runner": everything a builder does — claim
     * commands, ack them, post its screens, transcript, state and progress —
     * plus everything an agent does. "agent": an agent that drives sessions
     * (start, send, read, notify, file feedback) and may NOT act as a builder,
     * so it cannot take another builder's work or show the owner a screen
     * that no PTY printed. Every token minted before the column existed was
     * minted as a builder's or with a builder's powers, so they stay "runner".
     */
    kind: text("kind").$type<AgentTokenKind>().notNull().default("runner"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "cascade" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }), // null = never expires
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_agent_tokens_user_id").on(t.userId),
    index("idx_agent_tokens_token").on(t.token),
  ],
);

export const AGENT_TOKEN_KINDS = ["runner", "agent"] as const;
export type AgentTokenKind = (typeof AGENT_TOKEN_KINDS)[number];

export type AgentToken = typeof agentTokens.$inferSelect;
export type NewAgentToken = typeof agentTokens.$inferInsert;
