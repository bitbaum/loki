/**
 * Fleet Runner's placement of a workbench window, from the display list.
 *
 * Run: npx tsx scripts/test/workbench-placement.ts
 */
import assert from "node:assert/strict";
import {
  isOpenableUrl,
  placeWorkbenchWindow,
  sameOrigin,
} from "../../desktop/src/main/workbench-placement";

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

console.log("workbench-placement: ok");
