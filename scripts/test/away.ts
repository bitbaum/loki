/**
 * "Back in 30 minutes": the status from two timestamps, and the card's lines.
 * Run: npx tsx scripts/test/away.ts
 */
import assert from "node:assert/strict";
import { awayDuration, awayLines, awayStatus, type AwaySummary } from "@/lib/away-rules";

const NOW = Date.parse("2026-10-10T10:00:00Z");
const iso = (minFromNow: number) => new Date(NOW + minFromNow * 60_000).toISOString();

assert.deepEqual(awayStatus({ awaySince: null, awayUntil: null }, NOW), { state: "none" });
assert.equal(awayStatus({ awaySince: iso(-10), awayUntil: iso(20) }, NOW).state, "away");
assert.equal(awayStatus({ awaySince: iso(-40), awayUntil: iso(-10) }, NOW).state, "back");
assert.equal(
  awayStatus({ awaySince: iso(-4 * 24 * 60), awayUntil: iso(-4 * 24 * 60 + 30) }, NOW).state,
  "none",
  "an absence nobody came back from expires",
);
assert.equal(awayStatus({ awaySince: "garbage", awayUntil: iso(5) }, NOW).state, "none");

assert.equal(awayDuration(0), "a moment");
assert.equal(awayDuration(32), "32 min");
assert.equal(awayDuration(65), "1 h 05 min");
assert.equal(awayDuration(120), "2 h");
assert.equal(awayDuration(49 * 60), "2 days");

const base: AwaySummary = {
  since: iso(-30),
  until: iso(0),
  minutes: 30,
  runs: { started: 0, finished: 0, ok: 0, failed: 0, running: 0 },
  projects: [],
  reports: { arrived: 0, live: 0 },
  needsYou: 0,
};
assert.deepEqual(awayLines(base), [
  { text: "Nothing moved. Nothing needs you.", href: "/control" },
]);

const busy = awayLines({
  ...base,
  runs: { started: 4, finished: 3, ok: 2, failed: 1, running: 1 },
  projects: ["kestrel", "harbourlight"],
  reports: { arrived: 2, live: 1 },
  needsYou: 2,
});
assert.deepEqual(
  busy.map((l) => l.text),
  [
    "2 things need you",
    "1 fix is live — check it",
    "3 runs finished (2 ok, 1 failed) on kestrel, harbourlight",
    "1 still runs",
    "2 new reports arrived",
  ],
);
assert.equal(busy[0].href, "/feedback", "what needs you leads, and links to where it is acted on");

console.log("✓ away tests passed");
