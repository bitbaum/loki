/**
 * The widget's intent vocabulary must equal the ingest's.
 *
 * widget/ may not import from src/ (widget-self-contained.ts), so the two
 * lists are written twice. A value the widget sends that the route does not
 * accept fails zod, and the route answers the WHOLE submission with a bare
 * "Invalid submission" — the visitor loses their report. So they are compared
 * here instead of remembered.
 *
 * Also pins the "show me how" prompt: it must not tell the agent to build a
 * new feature first, and must carry the reporter's element.
 *
 * Run: npx tsx scripts/test/widget-intents.ts
 */
import assert from "node:assert/strict";
import { FEEDBACK_INTENT_VALUES } from "../../src/lib/constants/statuses";
import {
  defaultWidgetIntent,
  isWidgetIntent,
  WIDGET_INTENT_META,
  WIDGET_INTENTS,
} from "../../widget/intents";
import {
  composeFeedbackBatchFixPrompt,
  composeFeedbackFixPrompt,
} from "../../src/lib/feedback/compose-dispatch";

assert.deepEqual([...WIDGET_INTENTS], [...FEEDBACK_INTENT_VALUES]);
assert.equal(defaultWidgetIntent(), "build");
assert.equal(isWidgetIntent("guide"), true);
assert.equal(isWidgetIntent("delete-everything"), false);
for (const intent of WIDGET_INTENTS) {
  assert.ok(WIDGET_INTENT_META[intent].label.length > 0, `${intent} has a label`);
}

const base = {
  suggestion: "I can't find where to change my payout wallet",
  duplicateCount: 1,
  url: "https://orangecat.ch/dashboard",
  page: "/dashboard",
  scope: "element",
  selectedElements: [{ elementType: "div", elementText: "Draft product", selector: "div.card" }],
};

const build = composeFeedbackFixPrompt(base, "OrangeCat");
assert.match(build, /^Fix this visitor feedback on OrangeCat\./);
assert.doesNotMatch(build, /HOW TO GET THERE/);

// A legacy row (no intent) is a build.
assert.equal(composeFeedbackFixPrompt({ ...base, intent: null }, "OrangeCat"), build);

const guide = composeFeedbackFixPrompt({ ...base, intent: "guide" }, "OrangeCat");
assert.match(guide, /^Show this visitor the way on OrangeCat\./);
assert.match(guide, /already does what they want/);
assert.match(guide, /findable from the element or page they pointed at/);
assert.match(guide, /div\.card/);

const batch = composeFeedbackBatchFixPrompt([base, { ...base, intent: "guide" }], "OrangeCat");
assert.equal((batch.match(/Intent: show me how/g) ?? []).length, 1);

console.log("widget-intents: ok");
