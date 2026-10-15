import assert from "node:assert/strict";
import { feedbackContentHash } from "../../src/lib/feedback/content-hash";
import { FeedbackCaptureContextSchema } from "../../src/lib/feedback/capture-context-schema";
import {
  composeFeedbackFixPrompt,
  composeFeedbackBatchFixPrompt,
} from "../../src/lib/feedback/compose-dispatch";

const context = {
  "Page when speaking": "https://example.ch/pricing",
  "Screen when speaking": "390×844; scroll 0,900",
  "Pointed at": "Choose this plan (#price)",
};
assert(FeedbackCaptureContextSchema.safeParse(context).success);
assert(!FeedbackCaptureContextSchema.safeParse({ secret: "x".repeat(301) }).success);
assert(
  !FeedbackCaptureContextSchema.safeParse(
    Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`field${i}`, "value"])),
  ).success,
);
const feedback = {
  suggestion: "These are the visitor's exact words.",
  duplicateCount: 1,
  url: "https://example.ch/pricing",
  page: "/pricing",
  scope: "element",
  selectedElements: [
    { elementType: "button", elementText: "Choose this plan", selector: "#price" },
  ],
  captureContext: context,
};
for (const prompt of [
  composeFeedbackFixPrompt(feedback, "AoZ"),
  composeFeedbackBatchFixPrompt([feedback], "AoZ"),
]) {
  assert(prompt.includes(feedback.suggestion));
  assert(prompt.includes("PAGE CONTEXT WHEN COMMENTING"));
  assert(prompt.includes("scroll 0,900"));
  assert(prompt.includes("#price"));
  assert(prompt.includes("no unrelated refactors"));
}
console.log(
  "Feedback capture: bounded structured context survives single and batch development handoff",
);

const capture = { intent: "note" as const, context, selectedElements: [{ selector: "#price" }] };
const key = feedbackContentHash("Hard to find", "/pricing", capture);
assert.equal(
  key,
  feedbackContentHash("Hard to find", "/pricing", {
    ...capture,
    context: { ...context, "Note captured": "a later retry" },
  }),
);
assert.notEqual(
  key,
  feedbackContentHash("Hard to find", "/pricing", {
    ...capture,
    selectedElements: [{ selector: "#other" }],
  }),
);
assert.notEqual(
  key,
  feedbackContentHash("Hard to find", "/pricing", { ...capture, intent: "fix" }),
);
console.log(
  "Feedback dedupe preserves separate targets and note/fix intent while allowing retries",
);
