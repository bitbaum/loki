/**
 * Where a workbench window goes, from the display list — the one rule the
 * browser popup and Fleet Runner's real windows share.
 *
 * Run: npx tsx scripts/test/workbench-placement.ts
 */
import assert from "node:assert/strict";
import {
  isOpenableUrl,
  placeWorkbenchWindow,
  sameOrigin,
  windowKey,
} from "../../src/lib/workbench/placement";

const laptop = { id: 1, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
const monitor = { id: 2, workArea: { x: 1440, y: 0, width: 2560, height: 1415 } };

// Two displays, the other one asked for: the whole of it, the caller untouched.
assert.deepEqual(
  placeWorkbenchWindow({ placement: "other-screen", displays: [laptop, monitor], currentId: 1 }),
  { window: monitor.workArea, caller: null },
);
// Called from the monitor: "other" is the laptop.
assert.deepEqual(
  placeWorkbenchWindow({ placement: "other-screen", displays: [laptop, monitor], currentId: 2 })
    .window,
  laptop.workArea,
);
// Beside: tile this display, caller left, new window right.
assert.deepEqual(
  placeWorkbenchWindow({ placement: "beside", displays: [laptop, monitor], currentId: 1 }),
  {
    window: { x: 720, y: 25, width: 720, height: 875 },
    caller: { x: 0, y: 25, width: 720, height: 875 },
  },
);
// Fleet Runner's shell will not go under 800px: it keeps that, the new
// window takes the rest, and the two still meet instead of overlapping.
assert.deepEqual(
  placeWorkbenchWindow({
    placement: "beside",
    displays: [laptop],
    currentId: 1,
    minCallerWidth: 800,
  }),
  {
    window: { x: 800, y: 25, width: 640, height: 875 },
    caller: { x: 0, y: 25, width: 800, height: 875 },
  },
);
// A display too small for both: the new window keeps a usable width and
// the caller keeps its minimum — they overlap, which is the honest answer.
const small = { id: 3, workArea: { x: 0, y: 0, width: 1024, height: 768 } };
assert.deepEqual(
  placeWorkbenchWindow({
    placement: "beside",
    displays: [small],
    currentId: 3,
    minCallerWidth: 800,
  }),
  {
    window: { x: 544, y: 0, width: 480, height: 768 },
    caller: { x: 0, y: 0, width: 800, height: 768 },
  },
);
// A browser popup beside a window it cannot move: the right half, never
// narrower than a usable page.
assert.deepEqual(
  placeWorkbenchWindow({
    placement: "beside",
    displays: [{ id: 0, workArea: { x: 100, y: 50, width: 800, height: 600 } }],
    currentId: 0,
  }).window,
  { x: 420, y: 50, width: 480, height: 600 },
);
// One display and the other screen asked for: beside, honestly.
assert.deepEqual(
  placeWorkbenchWindow({ placement: "other-screen", displays: [laptop], currentId: 1 }).caller,
  { x: 0, y: 25, width: 720, height: 875 },
);
// A caller on a display that vanished (unplugged mid-call) lands on the first.
assert.equal(
  placeWorkbenchWindow({ placement: "beside", displays: [laptop], currentId: 9 }).window.x,
  720,
);

// Only pages open.
assert.equal(isOpenableUrl("https://loki.orangecat.ch/projects/x/workbench?pane=loki"), true);
assert.equal(isOpenableUrl("http://localhost:3000/"), true);
assert.equal(isOpenableUrl("file:///etc/passwd"), false);
assert.equal(isOpenableUrl("javascript:alert(1)"), false);
assert.equal(isOpenableUrl("not a url"), false);
assert.equal(sameOrigin("https://loki.orangecat.ch/a", "https://loki.orangecat.ch/"), true);
assert.equal(sameOrigin("https://evig.orangecat.ch/", "https://loki.orangecat.ch/"), false);
assert.equal(sameOrigin("nope", "https://loki.orangecat.ch/"), false);

// One window per page: the owner's pass in the fragment changes per visit.
assert.equal(
  windowKey("https://aoz.orangecat.ch/#loki-owner=abc"),
  windowKey("https://aoz.orangecat.ch/#loki-owner=def"),
);
assert.notEqual(windowKey("https://a.ch/x"), windowKey("https://a.ch/y"));

console.log("workbench-placement: ok");
