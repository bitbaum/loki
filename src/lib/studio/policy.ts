import type { CourseAssessmentInput } from "@/config/studio";
import type { StudioCommissionContract } from "@/lib/studio-commission";

export class StudioConflict extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export function validateCourseEvidence(
  assessment: CourseAssessmentInput | null,
  contract: StudioCommissionContract | null,
) {
  const course = contract?.course;
  if (!assessment || !course || assessment.version !== course.version)
    throw new StudioConflict(
      "The course version changed or evidence is missing. Review the current course and submit it again.",
    );
  const expected = course.modules.map((m) => m.id).sort();
  const actual = Object.keys(assessment.answers).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw new StudioConflict("Submit an answer for every current course module.", 400);
}
export function requireCurrentPreview(
  row: { kind: string; status: string; deliveryVersion: number; previewUrl: string | null },
  version: number,
) {
  if (row.kind !== "website" || !row.previewUrl || row.deliveryVersion < 1)
    throw new StudioConflict("There is no preview to review yet.");
  if (version !== row.deliveryVersion)
    throw new StudioConflict(
      "A newer preview is available. Reload and review that version before deciding.",
    );
  if (!["ready_for_review", "changes_requested", "accepted"].includes(row.status))
    throw new StudioConflict("This preview is not open for review. Read the latest studio note.");
}
export function requireDeliveryVersion(current: number, expected: number) {
  if (current !== expected)
    throw new StudioConflict("A newer delivery exists. Reload before publishing a revision.");
}
