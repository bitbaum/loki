"use client";

import { unansweredTurn, UNANSWERED_TEXT, type ThreadMessageLike } from "@/lib/loki/unanswered";

/**
 * What the dock says, and offers, when a thread was left hanging: a question
 * nothing is answering (lib/loki/unanswered) and messages a reload brought
 * back with no answer running to send them after (hooks/use-send-queue).
 * Kept out of LokiWorkspace, which is the composition, not the rules.
 */
export function useThreadRecovery(input: {
  messages: readonly ThreadMessageLike[];
  sending: boolean;
  loading: boolean;
  error: string | null;
  streamError: string | null;
  /** Re-send after a failed turn; undefined when there is nothing to re-send. */
  retryAfterError?: () => void;
  /** Ask again for a question that is already in the thread. */
  askAgain: (text: string) => void;
  /** Send the first waiting message of this thread. */
  sendNext: () => void;
}) {
  const lost = unansweredTurn(input.messages, {
    sending: input.sending,
    loading: input.loading,
    queued: 0,
  });
  const message = input.error ?? input.streamError ?? (lost ? UNANSWERED_TEXT : null);
  const onRetry =
    input.streamError && input.retryAfterError
      ? input.retryAfterError
      : lost && !input.error
        ? () => input.askAgain(lost.text)
        : undefined;
  return {
    turnError: { message, onRetry },
    // Offered only when no answer is running and none is owed first.
    onSendNow: !input.sending && !lost ? input.sendNext : undefined,
  };
}
