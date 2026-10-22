// Dragging the launcher: snap to the nearest side edge at the dropped height,
// remembered per site. Pure half — the browser half is in
// widget-host-avoid-browser.ts ("drag").
// Run: npx tsx scripts/test/widget-drag.ts
import assert from "node:assert/strict";
import { dragTop, snapToEdge, SNAP_MARGIN } from "../../widget/visitor-placement";

const vp = { width: 400, height: 800 };
const at = (left: number, top: number) => ({ left, top, width: 44, height: 44 });

assert.equal(snapToEdge(at(10, 300), vp).side, "left", "dropped left of centre → left edge");
assert.equal(snapToEdge(at(300, 300), vp).side, "right", "dropped right of centre → right edge");
assert.equal(snapToEdge(at(0, 0), vp).y, 0, "top clamps to 0");
assert.equal(snapToEdge(at(0, 2000), vp).y, 1, "below the fold clamps to 1");
const mid = snapToEdge(at(300, 378), vp);
assert.ok(Math.abs(mid.y - 0.5) < 0.01, "middle drop is y≈0.5");
// Round trip: the height you let go at is the height it stays at.
assert.equal(dragTop(mid, 44, 800), 378);
assert.equal(dragTop({ side: "left", y: 0 }, 44, 800), SNAP_MARGIN);
assert.equal(dragTop({ side: "left", y: 1 }, 44, 800), 800 - 44 - SNAP_MARGIN);
// A fraction survives a smaller viewport and stays on screen.
assert.ok(dragTop({ side: "right", y: 1 }, 44, 500) + 44 <= 500);
console.log("✓ drag snaps to the nearest edge and keeps its height");
