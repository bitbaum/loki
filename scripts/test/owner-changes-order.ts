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

// The widget route sorts with it and sends no rank field to the browser.
const route = readFileSync("src/app/api/widget/owner/changes/route.ts", "utf8");
assert.match(route, /orderForOwner\(/, "the owner's rows are ordered for the owner");
assert.match(route, /needsYou: _needsYou, \.\.\.change/, "the rank input stays server-side");

console.log("✓ owner-changes-order: the rows the line counts are the rows the list shows first");
