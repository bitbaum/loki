import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";
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
    /** When the person last had this thread open. Anything an assistant
     *  wrote after it — an answer, a run's outcome, a question — is news,
     *  and the rail says so (lib/loki/thread-state.ts). */
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    /** Pinned threads stay at the top of the rail: the few being juggled
     *  today, chosen by the person, not guessed from recency. */
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    /** A temporary chat: never listed, never read into memory or suggestions,
     *  deleted when the person leaves it and by the daily sweep in any case
     *  (lib/loki/temporary-chat.ts). */
    ephemeral: boolean("ephemeral").notNull().default(false),
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
