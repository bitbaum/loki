/**
 * Suggested changes are built as ONE change: the ticked items become one
 * request, so one agent and one pull request, not five queued runs.
 *
 * Run: npx tsx scripts/test/widget-suggestions.ts
 */
import assert from "node:assert/strict";
import { buildLabel, combineChanges } from "../../widget/suggestions";

assert.equal(combineChanges(["Add alt text"]), "Add alt text", "one item is sent as written");
const three = combineChanges(["Add alt text", "Rename the button", "Add a CTA"]);
assert.match(three, /^Make these changes on this page, together:\n1\. Add alt text\n2\. /);
assert.ok(three.endsWith("3. Add a CTA"));

assert.equal(buildLabel(3, true), "Build these 3 as one change →");
assert.equal(buildLabel(1, true), "Build this →");
assert.equal(buildLabel(2, false), "Send these 2 to the builder →");
assert.equal(buildLabel(0, true), "Tick what to build");

console.log("✓ widget suggestions: ticked changes go as one");
