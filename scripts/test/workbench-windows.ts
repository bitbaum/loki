/**
 * What a browser is told about a workbench window, and what the windows say
 * to each other. (Where a window goes is scripts/test/workbench-placement.ts.)
 *
 * Run: npx tsx scripts/test/workbench-windows.ts
 */
import assert from "node:assert/strict";
import { openingNote, popupFeatures } from "../../src/lib/workbench/windows";
import { parseBusMessage, workbenchChannelName } from "../../src/lib/workbench/bus";

assert.equal(
  popupFeatures({ x: 1440, y: 0, width: 2560, height: 1440 }),
  "popup,left=1440,top=0,width=2560,height=1440",
);

// Only a refused window earns a word.
assert.equal(openingNote(null), null);
assert.equal(openingNote({ how: "opened" }), null);
assert.equal(openingNote({ how: "placed" }), null);
assert.equal(openingNote({ how: "focused" }), null);
assert.equal(openingNote({ how: "desktop" }), null);
assert.match(openingNote({ how: "blocked" }) ?? "", /pop-ups/);

// The bus accepts exactly its own messages.
assert.deepEqual(parseBusMessage({ kind: "pane", pane: "watch", state: "open", from: "w1" }), {
  kind: "pane",
  pane: "watch",
  state: "open",
  from: "w1",
});
assert.equal(parseBusMessage({ kind: "pane", pane: "site", state: "open", from: "w1" }), null);
assert.equal(parseBusMessage({ kind: "pane", pane: "watch", state: "gone", from: "w1" }), null);
assert.equal(parseBusMessage({ kind: "pane", pane: "watch", state: "open", from: "" }), null);
assert.equal(parseBusMessage("pane"), null);
assert.equal(workbenchChannelName("p1"), "loki:workbench:p1");

console.log("workbench-windows: ok");
