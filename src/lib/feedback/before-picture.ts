/**
 * The "before" picture: the live page as it is at the moment a fix is
 * dispatched, so that once the fix is live the walkthrough can show before
 * and after side by side — "what the difference is" in one glance instead
 * of a description of one (owner, 2026-10-17).
 *
 * One headless screenshot (lib/feedback/page-picture, phone-sized, queued
 * one at a time), no model call, kept on the run as payload.beforePicture
 * beside the after picture verify-live keeps as payload.fixPicture. It runs
 * after the dispatch is accepted and never blocks it: a missing browser or a
 * page that does not load leaves the run without a before, and the card
 * simply shows the after on its own.
 */
import { takePagePicture } from "@/lib/feedback/page-picture";
import { mergeRunPayload } from "@/db/queries/orchestration-runs";

export async function captureBeforePicture(
  runId: string,
  url: string,
  selector: string | null,
): Promise<boolean> {
  try {
    const shot = await takePagePicture(url, selector);
    if (!shot.ok) return false;
    await mergeRunPayload(runId, {
      beforePicture: `data:${shot.mimeType};base64,${shot.base64}`,
    });
    return true;
  } catch (e) {
    console.error("[before-picture]", e instanceof Error ? e.message : e);
    return false;
  }
}
