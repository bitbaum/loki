/**
 * Crew consent is attached to a specific ask, not to a person in the abstract.
 *
 * Changing who is asked, what they must do, the deadline, the project, or
 * the promised fee invalidates the old ask. The owner must share a fresh link
 * and the new/current assignee must answer it.
 *
 * Pure rules here are consumed by the authoritative, row-locked DB writer.
 */
import type { HumanTask } from "@/db/schema/human-tasks";

export const WORK_TERMS_FIELDS = [
  "assigneeId",
  "projectId",
  "title",
  "brief",
  "reason",
  "dueDate",
  "feeAmount",
  "feeCurrency",
] as const;

export type WorkTermsPatch = Partial<Pick<HumanTask, (typeof WORK_TERMS_FIELDS)[number]>>;

function equalValue(before: unknown, after: unknown): boolean {
  if (before instanceof Date || after instanceof Date) {
    return (
      (before instanceof Date ? before.getTime() : before) ===
      (after instanceof Date ? after.getTime() : after)
    );
  }
  return before === after;
}

export function changesCrewConsentTerms(existing: HumanTask, patch: WorkTermsPatch): boolean {
  return WORK_TERMS_FIELDS.some(
    (key) => patch[key] !== undefined && !equalValue(existing[key], patch[key]),
  );
}
