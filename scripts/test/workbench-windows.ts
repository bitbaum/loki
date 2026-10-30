/**
 * Where a workbench window goes, and what the windows say to each other.
 *
 * Run: npx tsx scripts/test/workbench-windows.ts
 */
import assert from "node:assert/strict";
import { popupBounds, popupFeatures } from "../../src/lib/workbench/windows";
import { parseBusMessage, workbenchChannelName } from "../../src/lib/workbench/bus";

const here = { left: 0, top: 0, width: 1440, height: 900 };
const other = { left: 1440, top: 0, width: 2560, height: 1440 };

// The other screen, whole, when there is one.
assert.deepEqual(popupBounds("other-screen", here, other), other);
// Asked for the other screen with only one: beside, like the fallback says.
assert.deepEqual(popupBounds("other-screen", here, null), {
  left: 720,
  top: 0,
  width: 720,
  height: 900,
});
// Beside: the right half of this screen, never narrower than a usable page.
assert.deepEqual(popupBounds("beside", { left: 100, top: 50, width: 800, height: 600 }, other), {
  left: 420,
  top: 50,
  width: 480,
  height: 600,
});
assert.equal(popupFeatures(other), "popup,left=1440,top=0,width=2560,height=1440");

// The bus accepts exactly its own messages.
assert.deepEqual(parseBusMessage({ kind: "pane", pane: "loki", state: "open", from: "w1" }), {
  kind: "pane",
  pane: "loki",
  state: "open",
  from: "w1",
});
assert.equal(parseBusMessage({ kind: "pane", pane: "site", state: "open", from: "w1" }), null);
assert.equal(parseBusMessage({ kind: "pane", pane: "loki", state: "gone", from: "w1" }), null);
assert.equal(parseBusMessage({ kind: "pane", pane: "loki", state: "open", from: "" }), null);
assert.equal(parseBusMessage("pane"), null);
assert.equal(workbenchChannelName("p1"), "loki:workbench:p1");

console.log("workbench-windows: ok");
