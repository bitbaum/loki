import { FEEDBACK_STATUS } from "@/lib/constants/statuses";

/**
 * Pure: why a queued dispatch must NOT be delivered any more, or null.
 *
 * A dispatch can wait a long time before a builder claims it: behind an older
 * run on the same project (the per-project FIFO gate) or through a runner
 * drain. Whatever it was for may be finished by then. Substrata, 2026-10-22
 * 00:48: run 1fabd3b6 was held behind c7d57dc0, released the moment that run
 * closed during a runner restart, and Gemini started redoing the /chat
 * keyboard fix c7d57dc0 had already shipped as #190 — on a card already done.
 */
export function dispatchSupersededReason(s: {
  runFinished: boolean;
  feedbackStatus: string | null;
}): string | null {
  if (s.runFinished) return "its run was already closed";
  if (
    s.feedbackStatus === FEEDBACK_STATUS.RESOLVED ||
    s.feedbackStatus === FEEDBACK_STATUS.ARCHIVED
  )
    return `its feedback item is already ${s.feedbackStatus === FEEDBACK_STATUS.RESOLVED ? "done" : "filed away"}`;
  return null;
}
