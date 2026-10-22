import { and, desc, eq, gte, inArray, asc } from "drizzle-orm";
import { db } from "@/db";
import {
  chatFeedback,
  conversationMessages,
  conversations,
  type ChatFeedbackRow,
  type Conversation,
  type ConversationMessage,
} from "@/db/schema";

/** A thumb on an answer. The caller has verified the conversation is the
 *  person's (getConversationWithMessages); the message must be in it. */
export async function insertChatFeedback(input: {
  conversationId: string;
  messageId: string;
  verdict: "up" | "down";
  reason?: string | null;
  text?: string | null;
}): Promise<ChatFeedbackRow | null> {
  const [message] = await db
    .select({ id: conversationMessages.id, role: conversationMessages.role })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.id, input.messageId),
        eq(conversationMessages.conversationId, input.conversationId),
      ),
    )
    .limit(1);
  if (!message || message.role !== "assistant") return null;
  const [row] = await db
    .insert(chatFeedback)
    .values({
      conversationId: input.conversationId,
      messageId: input.messageId,
      verdict: input.verdict,
      reason: input.reason ?? null,
      text: input.text ?? null,
    })
    .returning();
  return row ?? null;
}

export type ConversationForReview = {
  conversation: Conversation;
  messages: ConversationMessage[];
  feedback: ChatFeedbackRow[];
};

/**
 * Conversations for the nightly review export: updated since `since`, newest
 * first, at most `limit`, never a temporary chat (that is what temporary
 * means) and never a channel Loki itself writes to (a project's updates
 * thread is not a conversation the person had).
 */
export async function listConversationsForReview(
  since: Date,
  limit: number,
): Promise<ConversationForReview[]> {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(gte(conversations.updatedAt, since), eq(conversations.ephemeral, false)))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit);
  const kept = rows.filter((c) => !c.channel);
  if (kept.length === 0) return [];
  const ids = kept.map((c) => c.id);
  const messages = await db
    .select()
    .from(conversationMessages)
    .where(inArray(conversationMessages.conversationId, ids))
    .orderBy(asc(conversationMessages.createdAt));
  const feedback = await db
    .select()
    .from(chatFeedback)
    .where(inArray(chatFeedback.conversationId, ids))
    .orderBy(asc(chatFeedback.createdAt));
  return kept.map((conversation) => ({
    conversation,
    messages: messages.filter((m) => m.conversationId === conversation.id),
    feedback: feedback.filter((f) => f.conversationId === conversation.id),
  }));
}
