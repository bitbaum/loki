// "Build them": which saved notes one tap starts.
// Run: npx tsx scripts/test/widget-saved-notes.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  groupNotesByPage,
  notePage,
  SAVED_NOTES_BUILD_MAX,
  savedNotesToBuild,
} from "../../src/lib/feedback/saved-notes";
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
// Group by page: one build per page, in the order the pages were first spoken about.
{
  const at = (id: string, page: string | null, url: string | null = null) => ({ id, page, url });
  const groups = groupNotesByPage([
    at("a", "/pricing"),
    at("b", "/"),
    at("c", "/pricing"),
    at("d", null, "https://site.ch/pricing?x=1"),
    at("e", null, "not a url"),
  ]);
  assert.deepEqual(
    groups.map((g) => g.map((n) => n.id)),
    [["a", "c", "d"], ["b"], ["e"]],
    "a note without a page joins its URL's page",
  );
  assert.equal(notePage({ page: "  /about " }), "/about");
  assert.equal(notePage({}), "");
}
// The route builds per page: one lone build, or one batch for several.
{
  const route = readFileSync("src/app/api/widget/owner/build/route.ts", "utf8");
  assert.match(route, /groupNotesByPage\(notes\)/);
  assert.match(route, /group\.length === 1\s*\?\s*await startOwnerBuild/);
  assert.match(route, /startOwnerBatchBuild\(token\.userId, token\.projectId, group\)/);
  // …and the inbox's "Implement all as one" uses the same batch dispatch.
  assert.match(
    readFileSync("src/app/api/projects/[id]/feedback/dispatch-batch/route.ts", "utf8"),
    /dispatchFeedbackBatch\(/,
  );
}
console.log("✓ widget-saved-notes: ok");
