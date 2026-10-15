import { addMessage } from "@/db/queries/conversations";
import { logDebug } from "@/db/queries/debug-logs";
import { projectUpdatesThreadId } from "@/lib/loki/updates-thread";
import { progressUpdateText } from "@/lib/loki/progress-update";
import {
  buildShippedUpdate,
  wantsAfterPicture,
  type ShippedUpdateInput,
} from "@/lib/loki/shipped-update";
import { saveConversationImages } from "@/db/queries/conversations";
import { conversationImagePath } from "@/lib/loki/message-images";
import { takePagePicture } from "@/lib/feedback/page-picture";
import type { UpdateImage } from "@/lib/loki/progress-update";

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/;
export const AFTER_CAPTION = "After — the live page now, on a phone";

/**
 * The "after" picture: the live page at phone size. When Loki already took
 * one to check the fix (verify-live.ts → payload.fixPicture) that is the
 * same page at the same moment, so it is reused instead of opening a second
 * browser. Stored like any chat picture (conversation_images) so the update
 * carries a path, not the bytes. No browser, or a page that will not load:
 * no picture, and the update still posts.
 */
async function afterPicture(
  userId: string,
  conversationId: string,
  url: string,
  selector: string | null,
  existing: string | null,
): Promise<UpdateImage | null> {
  let mimeType: string;
  let dataBase64: string;
  const kept = existing?.match(DATA_URL);
  if (kept) {
    mimeType = kept[1];
    dataBase64 = kept[2];
  } else {
    const shot = await takePagePicture(url, selector);
    if (!shot.ok) return null;
    mimeType = shot.mimeType;
    dataBase64 = shot.base64;
  }
  const [id] = await saveConversationImages(userId, conversationId, [
    { name: "after.jpg", mimeType, dataBase64 },
  ]);
  return id ? { src: conversationImagePath(conversationId, id), caption: AFTER_CAPTION } : null;
}

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
  input: ShippedUpdateInput & {
    userId: string;
    conversationId: string | null;
    /** The element the reporter pointed at, scrolled into view for the picture. */
    selector?: string | null;
    /** The picture verify-live already took of this page, if any. */
    existingPicture?: string | null;
  },
): Promise<void> {
  try {
    const conversationId =
      input.conversationId ?? (await projectUpdatesThreadId(input.userId, input.projectKey));
    const after = wantsAfterPicture(input)
      ? await afterPicture(
          input.userId,
          conversationId,
          input.livePageUrl!,
          input.selector ?? null,
          input.existingPicture ?? null,
        ).catch(() => null)
      : null;
    const update = buildShippedUpdate({ ...input, after });
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
