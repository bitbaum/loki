import { pgTable, uuid, text, timestamp, index, customType } from "drizzle-orm/pg-core";
import { users } from "./users";
import { conversations } from "./conversations";

/** Raw image bytes. Postgres `bytea`, read and written as a Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Pictures people put into a Loki chat — a screenshot of the bug, a photo of
 * the whiteboard, a sketch of the page they want.
 *
 * They used to reach the agent and the vision model and then vanish: the
 * message kept only "[Attached: screenshot.png (image)]", so the thread lost
 * the very thing the conversation was about, on reload and on every other
 * device (2026-10-12). Kept here, in their own table rather than in the
 * message row, because a thread is read whole (getConversationWithMessages)
 * and five 2 MB screenshots inline would make every busy thread megabytes to
 * open. The message carries only the path: /api/conversations/[id]/images/[imageId].
 *
 * Deleted with the conversation (cascade), so removing a chat removes its
 * pictures.
 */
export const conversationImages = pgTable(
  "conversation_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    mimeType: text("mime_type").notNull(),
    name: text("name").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_conversation_images_conversation").on(t.conversationId)],
);

export type ConversationImage = typeof conversationImages.$inferSelect;
