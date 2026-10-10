"use client";

import { cn } from "@/lib/utils";
import { FEEDBACK_WORK_PHASE, type FeedbackWorkView } from "@/lib/feedback/work-phase";

/** Honest status chip for feedback work — never says "dispatched". */
export function FeedbackWorkBadge({ work }: { work: FeedbackWorkView }) {
  // The tone follows WHO ACTS, like the lenses: green only when nothing is
  // waiting on a person (an agent at work, or done), red when it broke, amber
  // when it is the person's move. A deployed fix used to read green "like
  // Done — the operator only confirms"; under the "Needs you" heading that
  // green chip beside the Done lens's green chips was the page saying two
  // things with one colour (operator, 2026-10-10).
  const tone =
    work.phase === FEEDBACK_WORK_PHASE.WORKING || work.phase === FEEDBACK_WORK_PHASE.DONE
      ? "ui-tag-positive"
      : work.phase === FEEDBACK_WORK_PHASE.FAILED || work.phase === FEEDBACK_WORK_PHASE.STUCK
        ? "ui-tag-negative"
        : work.phase === FEEDBACK_WORK_PHASE.QUEUED ||
            work.phase === FEEDBACK_WORK_PHASE.NEEDS_VERIFY
          ? "ui-tag-warning"
          : "ui-tag";

  return (
    <span className={cn(tone, "shrink-0")} title={work.detail ?? work.label}>
      {work.label}
    </span>
  );
}
