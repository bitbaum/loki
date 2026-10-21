import assert from "node:assert/strict";
import {
  formatConciergeAnswer,
  visualAnswerInstruction,
} from "../../src/lib/widget-chat/answer-format";
import { parseRichBlock } from "@bitbaum/chatkit";
const raw = JSON.stringify({
  type: "callout",
  title: "Recommendation",
  body: "First sentence. Second sentence.",
});
const text = `Cat: Here is the recommendation.\n\n\`\`\`chat_ui\n${raw}\n\`\`\``;
const rich = formatConciergeAnswer(text, true);
assert.equal(rich, text, "the final fence survives sentence trimming");
assert.ok(parseRichBlock(rich.split("```chat_ui\n")[1]!.split("```")[0]!));
assert.equal(
  formatConciergeAnswer("**Cat:** Start here. Then an unfinished", false),
  "Cat: Start here.",
);
assert.equal(visualAnswerInstruction(false), "", "cached clients keep their existing format");
assert.ok(visualAnswerInstruction(true).includes("chat_ui"));
console.log("widget-visual-answer: 5 passed");
