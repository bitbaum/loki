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

// Rich answers can exceed the old plain-text response cap; they still need
// to survive intact, and the next request must fit the history API limit.
async function wireCheck() {
  const { askConcierge } = await import("../../widget/loki-api");
  const original = globalThis.fetch;
  Object.assign(globalThis, {
    location: { href: "https://studio.test/" },
    document: { title: "Studio" },
  });
  const block =
    "```chat_ui\n" +
    JSON.stringify({ type: "callout", title: "Context", body: "Useful context. ".repeat(125) }) +
    "\n```";
  const long = `Loki: Here is the context.\n\n${block}\n\n${block}`;
  let posted: { visualAnswers?: boolean; history?: { content: string }[] } = {};
  globalThis.fetch = async (_url, init) => {
    posted = JSON.parse(String(init?.body));
    return Response.json({ reply: long, messages: [{ speaker: "loki", text: long }], links: [] });
  };
  try {
    const answer = await askConcierge({
      apiBase: "https://loki.test",
      token: "fcw_test",
      message: "Explain it",
      history: [{ role: "assistant", content: long }],
    });
    assert.equal(answer.messages[0]!.text, long, "complete visual blocks survive the response cap");
    assert.equal(posted.visualAnswers, true);
    assert.ok(posted.history![0]!.content.length <= 2000);
    assert.ok(
      !posted.history![0]!.content.includes("chat_ui"),
      "the model receives readable bounded history",
    );
    console.log("widget visual wire: 4 passed");
  } finally {
    globalThis.fetch = original;
  }
}
wireCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
