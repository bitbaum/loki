import { checkRateLimit } from "@/lib/rate-limit";
import { implementFeedback } from "@/lib/feedback/implement";

/** Owner notes start an agent each; this bounds what a leaked pass can spend. */
const OWNER_BUILDS_PER_DAY = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The owner said what to change; saying it IS the decision. Start the fix now,
 * through the same path as the Implement button, and say how it went so the
 * owner is never left guessing. A refusal is reported, not hidden: the note is
 * stored either way and waits in the inbox. Shared by the widget's Report
 * (an owner-pass note) and a walkthrough's "Not quite".
 */
export async function startOwnerBuild(
  ownerUserId: string,
  projectId: string,
  feedbackId: string,
): Promise<{ building: boolean; buildNote?: string }> {
  if (!checkRateLimit(`feedback:owner-build:${projectId}`, OWNER_BUILDS_PER_DAY, DAY_MS)) {
    return {
      building: false,
      buildNote: "Saved. You have sent a lot today, so this one waits in Loki for you to start.",
    };
  }
  try {
    const { status, body } = await implementFeedback(ownerUserId, feedbackId);
    if (status < 400 && typeof body.runId === "string") return { building: true };
    // 409 from a run that is queued or working: the note is already being
    // built, which is exactly what the owner wants to hear.
    if (status === 409 && body.alreadyRunning === true) return { building: true };
    const reason = typeof body.error === "string" ? body.error : null;
    return {
      building: false,
      buildNote: reason
        ? `Saved, but it could not start: ${reason}`
        : "Saved, but it could not start yet. It waits in Loki under Feedback.",
    };
  } catch {
    return {
      building: false,
      buildNote: "Saved, but it could not start yet. It waits in Loki under Feedback.",
    };
  }
}
