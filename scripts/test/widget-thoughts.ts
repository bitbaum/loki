/**
 * Watch's running notes: every recorded step becomes one plain sentence, and
 * "looked, nothing wrong" is said too — silence was the complaint.
 *
 * Run: npx tsx scripts/test/widget-thoughts.ts
 */
import assert from "node:assert/strict";
import {
  ago,
  thoughtFor,
  thoughtsFrom,
  thoughtsSummary,
  watchHeadline,
} from "../../widget/thoughts";
import { freshTrail, type TrailEntry } from "../../widget/watch-trail";

const t0 = 1_700_000_000_000;
const trail: TrailEntry[] = [
  { at: t0, kind: "page", text: "/" },
  { at: t0 + 3_000, kind: "look", text: "nothing stands out" },
  { at: t0 + 9_000, kind: "tap", text: "button “Team anlegen”" },
  { at: t0 + 9_500, kind: "request", text: "POST /api/groups → 201" },
  { at: t0 + 12_000, kind: "page", text: "/teams" },
  { at: t0 + 15_000, kind: "look", text: "2 things stand out" },
  { at: t0 + 20_000, kind: "request", text: "GET /api/me → 500" },
];

assert.equal(thoughtFor(trail[0]).text, "Opened the home page");
assert.equal(thoughtFor(trail[1]).tone, "good", "a clean look is said, and said as good news");
assert.equal(thoughtFor(trail[5]).tone, "warn");
assert.equal(thoughtFor(trail[6]).tone, "bad");
assert.match(thoughtFor(trail[3]).text, /^The page sent POST/);

const lines = thoughtsFrom(trail);
assert.equal(lines[0].at, t0 + 20_000, "newest first");
assert.equal(lines.length, trail.length);

assert.equal(thoughtsSummary(trail, true), "Watching · 2 pages, 1 press · 2 things to look at");
assert.equal(thoughtsSummary(trail.slice(0, 2), true), "Watching · 1 page · nothing wrong so far");
assert.match(thoughtsSummary([], true), /waiting for the page to settle/);
assert.match(thoughtsSummary(trail, false), /^Not watching/);

// The status line says the state, and the ONE number it ever carries is what
// waits on the owner (changes.ts changesHeadline). What Loki noticed is in the
// list, never counted on the line — "noticed 4 things" beside "9 changes need
// you" was two numbers of two things (2026-10-20).
assert.equal(watchHeadline(true), "Watching", "nothing waiting: just the state");
assert.equal(watchHeadline(false), "Paused");
assert.equal(watchHeadline(true, "2 changes need you"), "Watching · 2 changes need you");
assert.equal(watchHeadline(false, "1 change needs you"), "Paused · 1 change needs you");

// `look` survives a page load like every other step.
assert.equal(freshTrail(trail, t0 + 30_000).length, trail.length);

// What a tap DID is said under it — and a tap that did nothing is flagged.
assert.equal(
  thoughtFor({ at: t0, kind: "result", text: "the page changed" }).text,
  "↳ The page changed",
);
const nothing = thoughtFor({ at: t0, kind: "result", text: "nothing visibly happened" });
assert.equal(nothing.tone, "warn");
assert.equal(nothing.text, "↳ Nothing visibly happened");

assert.equal(ago(t0, t0 + 2_000), "now");
assert.equal(ago(t0, t0 + 45_000), "45s");
assert.equal(ago(t0, t0 + 5 * 60_000), "5m");

console.log("✓ widget thoughts: every step a sentence, clean looks included");
