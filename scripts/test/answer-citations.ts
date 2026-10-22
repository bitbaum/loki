import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownText } from "../../src/components/ui/markdown-text";
Object.assign(globalThis, { React });
/**
 * Citations in a Loki answer: out of the sentence, one Sources button per
 * answer, shared with the main chat. Case from the live site (2026-10-15): eight inline "Source"
 * buttons, each 44px tall, made one answer unreadable.
 */
let passed = 0;
function check(label: string, cond: boolean): void {
  if (!cond) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}
const citations = {
  F1: { label: "Runner", detail: "offline" },
  F2: { label: "Runs", detail: "5 waiting" },
  F5: { label: "Goals", detail: "none" },
  F7: { label: "Commitments", detail: "none" },
};
const html = (text: string) =>
  renderToStaticMarkup(createElement(MarkdownText, { text, citations }));
const count = (s: string, needle: string) => s.split(needle).length - 1;

const one = html(
  "The runner is offline [F1] and five runs wait [F2]. No goals or commitments [F5]–[F7], so nothing else blocks.",
);
check("no raw handle left in the prose", !/\[[FD]\d/.test(one));
check("one sources button for the paragraph", count(one, "ui-loki-cite") === 1);
check("it opens all four records", one.includes("View 4 sources"));
check("punctuation closes up where a handle was", one.includes("offline and five runs wait."));
check("a range leaves no stray dash", one.includes("commitments, so"));

const two = html("First claim [F1].\n\nSecond claim [F2].\n\nNo claim here.");
check("paragraphs share one sources sheet under the answer", count(two, "ui-loki-cite") === 1);
check("the sheet includes sources from every paragraph", two.includes("View 2 sources"));

const unknown = html("A claim [F9].");
check(
  "an unknown handle shows nothing",
  !unknown.includes("ui-loki-cite") && unknown.includes("A claim."),
);

const bare = renderToStaticMarkup(createElement(MarkdownText, { text: "No resolver [F1]." }));
check(
  "without a resolver the handle is dropped",
  bare.includes("No resolver.") && !bare.includes("ui-loki-cite"),
);

const list = html("- one [F1]\n- two");
check("a list item carries its own button", count(list, "ui-loki-cite") === 1);

console.log(`\nanswer-citations: ${passed} passed`);
