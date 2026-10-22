import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { conversations, conversationMessages } from "./conversations";

/**
 * A thumb under a Loki answer (chatkit's `AnswerFeedback`): the verdict, the
 * reason picked from the sheet, the person's own words when they typed any.
 *
 * Kept with the conversation and nothing else — no user id, no name. The
 * nightly review export (api/chat/review-export) sends these rows beside the
 * transcript, so the judge reads the person's own verdict next to its own.
 * One row per thumb; a second thumb on the same answer is a second row, in
 * order, and the latest is the one that counts.
 */
export const chatFeedback = pgTable(
  "chat_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => conversationMessages.id, { onDelete: "cascade" }),
    /** "up" | "down" — text, like every other status column here. */
    verdict: text("verdict").notNull(),
    /** One of chatkit's FEEDBACK_REASONS, when a reason was picked. */
    reason: text("reason"),
    text: text("text"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("idx_chat_feedback_conversation_id").on(table.conversationId)],
);

export type ChatFeedbackRow = typeof chatFeedback.$inferSelect;
export type NewChatFeedback = typeof chatFeedback.$inferInsert;
