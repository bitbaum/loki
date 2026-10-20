/**
 * The owner's change list reads in the order they care: what needs them,
 * then what is moving, then what is done (lib/feedback/owner-view).
 *
 * The panel's one line said "9 changes need you" and its open list showed
 * three rows of the newest changes — none of the nine (owner, 2026-10-18).
 *
 * Run: npx tsx scripts/test/owner-changes-order.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { orderForOwner, ownerChangeRank } from "@/lib/feedback/owner-view";

const row = (
  id: string,
  at: string,
  flags: Partial<{ needsYou: boolean; live: boolean; settled: boolean }>,
) => ({
  id,
  at,
  needsYou: false,
  live: false,
  settled: false,
  ...flags,
});

assert.equal(ownerChangeRank(row("a", "", { needsYou: true })), 0, "what needs you comes first");
assert.equal(ownerChangeRank(row("b", "", {})), 1, "what is moving comes next");
assert.equal(
  ownerChangeRank(row("c", "", { live: true, settled: true })),
  2,
  "what is done comes last",
);
assert.equal(
  ownerChangeRank(row("d", "", { settled: true })),
  2,
  "closed without going live is done too",
);

const ordered = orderForOwner([
  row("live-new", "2026-10-18T12:00:00Z", { live: true, settled: true }),
  row("building", "2026-10-18T11:00:00Z", {}),
  row("needs-old", "2026-10-17T09:00:00Z", { needsYou: true }),
  row("needs-new", "2026-10-18T10:00:00Z", { needsYou: true }),
  row("starting", "2026-10-18T11:30:00Z", {}),
]);
assert.deepEqual(
  ordered.map((c) => c.id),
  ["needs-new", "needs-old", "starting", "building", "live-new"],
  "needs-you first (newest first within), then moving, then live",
);

// The widget route sorts with it, over ALL the owner's rows, and only then
// cuts the list to twelve — and it counts what needs the owner over all of
// them. Ordering and counting inside the newest twelve let three fresh notes
// push three failed fixes out: "9 need you" became 6 with nothing done
// (2026-10-20).
const route = readFileSync("src/app/api/widget/owner/changes/route.ts", "utf8");
assert.match(route, /orderForOwner\(/, "the owner's rows are ordered for the owner");
assert.doesNotMatch(
  route,
  /FEEDBACK_SOURCE\.AI_REVIEW,?\s*\)\s*\.slice\(0, OWNER_CHANGES_MAX\)/,
  "never a window of the newest before ordering",
);
assert.match(route, /changes: ordered\.slice\(0, OWNER_CHANGES_MAX\)/, "cut after ordering");
assert.match(
  route,
  /needsYou: ordered\.filter\(\(c\) => c\.needsYou\)\.length/,
  "the line's number is counted over every row",
);

console.log("✓ owner-changes-order: the rows the line counts are the rows the list shows first");
