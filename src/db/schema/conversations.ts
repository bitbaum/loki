import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Loki conversations — persistent ChatGPT/Claude-style threads (see
 * docs/loki-command-surface.md §4). A conversation is the human-readable log
 * + control thread; it is tagged with 0..n project keys so the right-pane
 * project filter can scope the conversation list client-side.
 *
 * A message in a conversation either (a) chats with Loki or (b) dispatches work
 * to a project's agent session — the per-message `kind` records which path ran.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Project keys (user_projects.name) this thread is scoped to. Drives the
     *  right-pane filter; empty = unscoped. */
    projectKeys: text("project_keys").array().notNull().default([]),
    /** A thread Loki itself writes to, named so it is found again however the
     *  person renames it: `updates:<projectKey>` is a project's progress
     *  channel (lib/loki/updates-thread.ts). NULL for ordinary threads. */
    channel: text("channel"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_conversations_user_id").on(table.userId),
    uniqueIndex("uq_conversations_user_channel").on(table.userId, table.channel),
  ],
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** "user" | "assistant" | "system" — text, not an enum, to mirror the
     *  project's existing schema convention (see beacon-sessions agent fields). */
    role: text("role").notNull(),
    /** How the assistant turn was produced: "chat" (Loki reply), "command"
     *  (resolved but awaiting a project), or "dispatch" (sent to a project
     *  session). NULL for plain user turns. */
    kind: text("kind"),
    content: text("content").notNull(),
    /** Resolution metadata — e.g. { needsProject, projectKey, intentId }. */
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("idx_conversation_messages_conversation_id").on(table.conversationId)],
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type NewConversationMessage = typeof conversationMessages.$inferInsert;
