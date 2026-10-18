import { FEEDBACK_SOURCE } from "@/lib/constants/statuses";
import { FEEDBACK_WORK_PHASE, type FeedbackWorkPhase } from "@/lib/feedback/work-phase";

/** At most this many saved notes start in one tap: each is its own build. */
export const SAVED_NOTES_BUILD_MAX = 10;

/**
 * The owner's saved notes that are still waiting — what "Build them" starts.
 *
 * Recording while Loki watches and deciding later is the owner's way of
 * working (2026-10-18: "record my comments while it's watching, and then I
 * will implement them"). Save keeps a note out of automatic work
 * (requiresReview); this picks those back up, oldest first so the builds run
 * in the order things were said. A note already started, or written by
 * anyone but the owner, is left alone.
 */
export function savedNotesToBuild<
  T extends {
    id: string;
    source: string | null;
    requiresReview: boolean;
    createdAt: Date;
    work: { phase: FeedbackWorkPhase };
  },
>(items: readonly T[]): T[] {
  return items
    .filter(
      (i) =>
        i.source === FEEDBACK_SOURCE.OWNER &&
        i.requiresReview &&
        i.work.phase === FEEDBACK_WORK_PHASE.NOT_STARTED,
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, SAVED_NOTES_BUILD_MAX);
}
