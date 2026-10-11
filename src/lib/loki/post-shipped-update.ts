import { addMessage } from "@/db/queries/conversations";
import { logDebug } from "@/db/queries/debug-logs";
import { projectUpdatesThreadId } from "@/lib/loki/updates-thread";
import { progressUpdateText } from "@/lib/loki/progress-update";
import { buildShippedUpdate, type ShippedUpdateInput } from "@/lib/loki/shipped-update";

/**
 * "It's live" — or "the deploy failed" — written into the chat, as the
 * structured update the thread renders as a card.
 *
 * A run reports when it CLOSES, which is at a pull request: the change is
 * written, not shipped. The moment a person actually cares about comes later,
 * when the fix ledger sees the deploy succeed, and until now that moment went
 * only to push, Telegram and an alert (notify-shipped.ts) — never to the
 * conversation, the one place with room for the walkthrough, the screenshot
 * and the reasons. Fired from the same transition, so it posts once.
 */

/** Post it. Fire-and-forget like the other notifiers: never throws. */
export async function postShippedUpdate(
  input: ShippedUpdateInput & { userId: string; conversationId: string | null },
): Promise<void> {
  try {
    const conversationId =
      input.conversationId ?? (await projectUpdatesThreadId(input.userId, input.projectKey));
    const update = buildShippedUpdate(input);
    await addMessage(conversationId, {
      role: "assistant",
      kind: "outcome",
      content: progressUpdateText(update),
      meta: { update, feedbackId: input.feedbackId },
    });
  } catch (e) {
    void logDebug({
      source: "loki/post-shipped-update",
      level: "warn",
      message: `could not post the ${input.announcement} update for ${input.feedbackId}: ${(e as Error).message}`,
    });
  }
}
