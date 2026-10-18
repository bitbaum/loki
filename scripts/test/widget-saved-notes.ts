// "Build them": which saved notes one tap starts.
// Run: npx tsx scripts/test/widget-saved-notes.ts
import assert from "node:assert/strict";
import { SAVED_NOTES_BUILD_MAX, savedNotesToBuild } from "../../src/lib/feedback/saved-notes";
import { FEEDBACK_WORK_PHASE } from "../../src/lib/feedback/work-phase";

const note = (id: string, over: Partial<Parameters<typeof savedNotesToBuild>[0][number]> = {}) => ({
  id,
  source: "owner" as string | null,
  requiresReview: true,
  createdAt: new Date(Number(id.replace(/\D/g, "")) * 1000),
  work: {
    phase:
      FEEDBACK_WORK_PHASE.NOT_STARTED as (typeof FEEDBACK_WORK_PHASE)[keyof typeof FEEDBACK_WORK_PHASE],
  },
  ...over,
});

const picked = savedNotesToBuild([
  note("n3"),
  note("n1"),
  note("n2", { requiresReview: false }),
  note("n4", { source: "visitor" }),
  note("n5", { work: { phase: FEEDBACK_WORK_PHASE.QUEUED } }),
  note("n6", { source: null }),
]);
assert.deepEqual(
  picked.map((n) => n.id),
  ["n1", "n3"],
  "the owner's saved notes that have not started, oldest first",
);
assert.equal(
  savedNotesToBuild(Array.from({ length: 25 }, (_, i) => note(`n${i + 1}`))).length,
  SAVED_NOTES_BUILD_MAX,
  "one tap starts a bounded number",
);
console.log("✓ widget-saved-notes: ok");
