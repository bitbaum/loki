import { checkRateLimit } from "@/lib/rate-limit";
import { implementFeedback } from "@/lib/feedback/implement";
import { dispatchFeedbackBatch } from "@/lib/feedback/batch-dispatch";
import { getProjectCore } from "@/db/queries/projects";
import type { FeedbackPromptFields } from "@/lib/feedback/compose-dispatch";

/** Owner notes start an agent each; this bounds what a leaked pass can spend
 *  on ONE account's engine — a guard against a runaway loop, never a price.
 *  Keyed by the owner, not the project: it is their engine across all of
 *  their projects that a loop would drain. */
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
  if (!withinDailyLimit(ownerUserId)) return LIMITED;
  try {
    const { status, body } = await implementFeedback(ownerUserId, feedbackId);
    if (status < 400 && typeof body.runId === "string") return { building: true };
    // 409 from a run that is queued or working: the note is already being
    // built, which is exactly what the owner wants to hear.
    if (status === 409 && body.alreadyRunning === true) return { building: true };
    return notStarted(body.error);
  } catch {
    return notStarted(null);
  }
}

/**
 * Several of the owner's notes about ONE page as one build: one agent pass
 * fixes them together (the widget's "Build all", one build per page). Counts
 * as one build against the same daily limit.
 */
export async function startOwnerBatchBuild(
  ownerUserId: string,
  projectId: string,
  items: Array<FeedbackPromptFields & { id: string }>,
): Promise<{ building: boolean; buildNote?: string }> {
  if (!withinDailyLimit(ownerUserId)) return LIMITED;
  try {
    const project = await getProjectCore(ownerUserId, projectId);
    if (!project) return notStarted(null);
    const { body, accepted } = await dispatchFeedbackBatch(
      ownerUserId,
      { id: projectId, name: project.name },
      items,
    );
    return accepted ? { building: true } : notStarted((body as Record<string, unknown>).error);
  } catch {
    return notStarted(null);
  }
}

const withinDailyLimit = (ownerUserId: string) =>
  checkRateLimit(`feedback:owner-build:${ownerUserId}`, OWNER_BUILDS_PER_DAY, DAY_MS);

const LIMITED = {
  building: false,
  buildNote: "Saved. You have sent a lot today, so this one waits in Loki for you to start.",
} as const;

function notStarted(reason: unknown): { building: false; buildNote: string } {
  return {
    building: false,
    buildNote:
      typeof reason === "string"
        ? `Saved, but it could not start: ${reason}`
        : "Saved, but it could not start yet. It waits in Loki under Feedback.",
  };
}
