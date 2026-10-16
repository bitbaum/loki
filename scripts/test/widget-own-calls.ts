/**
 * Which requests are the widget's OWN (filed against Loki as a widget defect)
 * and which belong to the page it sits on. A prefix match on /api/feedback
 * once swept in Loki's own app polling /api/feedback/summary, and its
 * navigation-cut requests came back as "the widget never answered after 0.3s".
 *
 * Run: npx tsx scripts/test/widget-own-calls.ts
 */
import assert from "node:assert/strict";
import { isWidgetCall } from "../../widget/watch";

const api = "https://loki.orangecat.ch";

assert.equal(isWidgetCall(`${api}/api/feedback`, api), true, "sending a note");
assert.equal(isWidgetCall(`${api}/api/feedback?token=x`, api), true);
assert.equal(isWidgetCall(`${api}/api/widget/owner/changes`, api), true);
assert.equal(isWidgetCall(`${api}/api/widget-boot?token=x`, api), true);
assert.equal(isWidgetCall(`${api}/api/feedback/summary`, api), false, "the app's own poll");
assert.equal(isWidgetCall(`${api}/api/feedback/export?project=x`, api), false);
assert.equal(isWidgetCall("https://elsewhere.ch/api/feedback", api), false);

console.log("✓ widget own calls: only the widget's requests are the widget's");
