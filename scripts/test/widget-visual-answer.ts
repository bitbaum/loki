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

// The panel bundle carries its own dependency-free copy of richAnswerText
// (widget/rich-history.ts); it must say exactly what chatkit's says.
async function parityCheck() {
  const kit = await import("@bitbaum/chatkit");
  const mine = await import("../../widget/rich-history");
  const fence = (o: unknown) => "```chat_ui\n" + JSON.stringify(o) + "\n```";
  const samples = [
    "Plain answer, no visuals.",
    `Intro.\n\n${fence({ type: "callout", title: "T", body: "B" })}\n\nOutro.`,
    fence({ type: "gallery", title: "G", images: [{ src: "/a.jpg", alt: "A", caption: "C" }, { src: "https://x.test/b.png", alt: "B" }] }),
    fence({ type: "gallery", title: "Bad", images: [{ src: "javascript:alert(1)", alt: "A" }] }),
    fence({ type: "diagram", title: "D", nodes: [{ id: "a", label: "In", detail: "d" }, { id: "b", label: "Out" }], edges: [{ from: "a", to: "b", label: "to" }] }),
    fence({ type: "diagram", title: "D", nodes: [{ id: "a", label: "In" }], edges: [{ from: "a", to: "zz" }] }),
    fence({ type: "choices", title: "Next?", options: [{ label: "One", reply: "1" }], submit: "Go" }),
    fence({ type: "unknown", title: "U" }),
    "```chat_ui\n{not json",
    `Two ${fence({ type: "callout", title: "A", body: "a" })} and ${fence({ type: "callout", title: "B", body: "b" })}`,
  ];
  for (const s of samples) assert.equal(mine.richAnswerText(s), kit.richAnswerText(s), s.slice(0, 60));
  console.log(`widget rich-history parity: ${samples.length} passed`);
}
parityCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
