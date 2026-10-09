/**
 * The widget's answer formatting: markdown a model writes becomes blocks the
 * panel renders as text nodes — never HTML on someone else's site.
 *
 * Run: npx tsx scripts/test/widget-rich-text.ts
 */
import assert from "node:assert/strict";
import { parseBlocks, parseSpans } from "../../widget/rich-text";

// The answer that shipped with its asterisks showing (heidi, 2026-10-09).
const answer = [
  "The page is the user's personal dashboard.",
  "",
  "What works",
  "",
  "* The headline “Mein Bereich” clearly tells the user where they are.",
  "* The **“1 Tag in Folge”** section gives a clear daily goal.",
  "",
  "### What to change",
  "1. Add a prominent button",
].join("\n");
const blocks = parseBlocks(answer);
assert.deepEqual(
  blocks.map((b) => b.kind),
  ["p", "h", "ul", "h", "ul"],
  "a short label above a list reads as its heading",
);
// A sentence above a list stays a sentence.
assert.equal(parseBlocks("Here is what I found.\n* one")[0].kind, "p");
const list = blocks[2];
assert.ok(list.kind === "ul");
assert.equal(list.items.length, 2, "each * line is one bullet");
assert.ok(!list.items[0].some((s) => s.text.startsWith("*")), "the marker is gone");
assert.deepEqual(list.items[1][1], { text: "“1 Tag in Folge”", bold: true });

assert.deepEqual(parseSpans("no markup"), [{ text: "no markup" }]);
assert.deepEqual(parseSpans("a **b** c"), [
  { text: "a " },
  { text: "b", bold: true },
  { text: " c" },
]);
// A lone asterisk is literal, not a broken bold.
assert.deepEqual(parseSpans("5 * 3"), [{ text: "5 * 3" }]);
// Markup is data: angle brackets stay text for the renderer's text nodes.
assert.equal(parseBlocks("<img src=x onerror=alert(1)>")[0].kind, "p");

console.log("✓ widget rich text: bullets, headings, bold — as data, never HTML");
