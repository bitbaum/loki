/**
 * The phone sheet's thumb rules: up grows it, down shrinks it, a long pull
 * down puts it away, a small wobble changes nothing.
 *
 * Run: npx tsx scripts/test/widget-sheet.ts
 */
import assert from "node:assert/strict";
import { sheetSnap } from "../../widget/sheet";

assert.equal(sheetSnap("auto", -80), "full", "drag up: the whole screen");
assert.equal(sheetSnap("auto", 80), "peek", "drag down: a peek at the page");
assert.equal(sheetSnap("peek", 80), "close", "down from a peek: put away");
assert.equal(sheetSnap("auto", 200), "close", "a long pull down: put away");
assert.equal(sheetSnap("full", 200), "peek", "a long pull from full lands on a peek, not gone");
assert.equal(sheetSnap("auto", 20), "auto", "a wobble changes nothing");
assert.equal(sheetSnap("full", -80), "full");
assert.equal(sheetSnap("peek", -80), "auto");

console.log("✓ widget sheet: thumb sizes the panel");
