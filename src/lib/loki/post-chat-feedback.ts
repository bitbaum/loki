import type { AnswerFeedback } from "@bitbaum/chatkit";

/**
 * A thumb under a Loki answer, sent where every chat in the fleet sends its
 * thumbs: the product's own POST /api/chat/feedback
 * (docs/architecture/chat-review.md). Fire-and-forget by design — chatkit has
 * already said "Thanks, noted", and a thumb is not something to make a person
 * retry; a failure is logged and the nightly review still reads the chat.
 */
export function postChatFeedback(conversationId: string, feedback: AnswerFeedback): void {
  void fetch("/api/chat/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, ...feedback }),
    keepalive: true,
  }).catch(() => {});
}
