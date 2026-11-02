/**
 * Watching Loki's browser: the pointer lands on what is pressed, the view
 * leans in only when it must, and the ending reads like a person.
 *
 * Run: npx tsx scripts/test/robot-view.ts
 */
import assert from "node:assert/strict";
import {
  leanOf,
  MAX_LEAN,
  pagesSeen,
  spotOf,
  viewOf,
  walkEnding,
} from "../../src/lib/inspection/robot-view";
import { ReviewFrame } from "../../src/lib/inspection/contract";

const desktop = { width: 1440, height: 900 };

// A press in the middle of a desktop page.
const spot = spotOf(desktop, { x: 700, y: 430, width: 40, height: 40 });
assert.deepEqual(spot, {
  x: 50,
  y: 50,
  left: (700 / 1440) * 100,
  top: (430 / 900) * 100,
  width: (40 / 1440) * 100,
  height: (40 / 900) * 100,
});
// A frame that only looks, or a press outside the picture: no pointer.
assert.equal(spotOf(desktop, undefined), null);
assert.equal(spotOf(desktop, { x: 2000, y: 10, width: 10, height: 10 }), null);
assert.equal(spotOf({ width: 0, height: 0 }, { x: 1, y: 1, width: 1, height: 1 }), null);

// Lean in: none for a phone page at phone width, some for desktop in a
// column, never past the cap, and never without a press.
assert.equal(leanOf(390, 390, spot), 1);
assert.equal(leanOf(1440, 720, spot), 1.1);
assert.equal(leanOf(1440, 390, spot), 2.03);
assert.equal(leanOf(1440, 320, spot), MAX_LEAN);
assert.equal(leanOf(1440, 390, null), 1);

// The view: no void, readable, the press kept in sight.
const phone = { width: 390, height: 760 };
// A phone page in a wide, tall box: full height, centred like a phone.
assert.deepEqual(viewOf(phone, { width: 680, height: 740 }, null), {
  boxHeight: 740,
  layer: { width: 379.74, height: 740, x: 150.13, y: 0 },
});
// A desktop page in a tall column: fills the height, cropped at the sides,
// slid so the press is in the middle — and never past the picture's edge.
const corner = spotOf(desktop, { x: 1290, y: 25, width: 108, height: 40 });
const tall = viewOf(desktop, { width: 680, height: 740 }, corner);
assert.equal(tall.layer.height, 740);
assert.equal(tall.layer.x, 680 - tall.layer.width, "a press at the right edge pins the right edge");
assert.equal(tall.layer.y, 0);
const middle = viewOf(desktop, { width: 680, height: 740 }, spot);
assert.equal(middle.layer.x, 680 / 2 - middle.layer.width / 2, "a press in the middle is centred");
// A desktop page on a phone (fit width): leans in, the press stays on
// screen with room around it, the box keeps the page's own height.
const narrow = viewOf(desktop, { width: 358, height: null }, corner);
assert.equal(narrow.boxHeight, 223.75);
assert.ok(narrow.layer.width > 358, "it leans in");
const pressAt = (corner!.x / 100) * narrow.layer.width + narrow.layer.x;
assert.ok(pressAt > 0 && pressAt < 358, "the press is on screen");
// Nothing to press: the whole page across the width, top first.
assert.deepEqual(viewOf(desktop, { width: 358, height: null }, null), {
  boxHeight: 223.75,
  layer: { width: 358, height: 223.75, x: 0, y: 0 },
});

// The ending.
assert.deepEqual(walkEnding(6, 0), {
  title: "All done. It looks good.",
  detail: "Loki looked at 6 pages and found nothing to fix.",
});
assert.equal(walkEnding(1, 1).detail, "Loki looked at one page and found one thing worth fixing.");
assert.equal(walkEnding(3, 2).detail, "Loki looked at 3 pages and found 2 things worth fixing.");

// Pages are counted once, whatever widths they were seen at.
assert.equal(
  pagesSeen([
    { url: "https://a.ch/", result: "visited" },
    { url: "https://a.ch/", result: "visited" },
    { url: "https://a.ch/x", result: "blocked" },
    { url: "https://a.ch/y", result: "visited" },
  ]),
  2,
);

// The contract takes a frame with a target and one without (older frames).
const base = {
  url: "https://a.orangecat.ch/",
  image: "data:image/jpeg;base64,AAAA",
  width: 1440,
  height: 900,
  action: "Following Pricing",
  scrollY: 0,
};
assert.ok(ReviewFrame.safeParse(base).success);
assert.ok(ReviewFrame.safeParse({ ...base, target: { x: 1, y: 2, width: 3, height: 4 } }).success);
assert.equal(
  ReviewFrame.safeParse({ ...base, target: { x: Infinity, y: 2, width: 3, height: 4 } }).success,
  false,
);

console.log("robot-view: ok");
