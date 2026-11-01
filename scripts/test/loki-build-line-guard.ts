/**
 * The bold next-build line is held back unless the person asked for direction
 * (lib/loki/build-line.ts).
 *
 * Agreed in the first dogfooding round (2026-10-31) between two companions
 * briefed on how Ask Loki works. Their acceptance cases are the fixtures:
 * "What was our spending last week?" must come back without a build line, and
 * "What should I build next?" must keep it. The guard is mechanical because
 * the prompt's "when the operator is deciding what to do" is read as "always"
 * by the smaller fallback models.
 * Run: npx tsx scripts/test/loki-build-line-guard.ts
 */
import assert from "node:assert/strict";
import { askedForBuild, holdBuildLine, readBuildLine } from "../../src/lib/loki/build-line";

let pass = 0;
function check(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const spending =
  "Last week you spent CHF 412 across three projects [F2]; the bakery took CHF 260 of it [F3].\n\n**bakery: cut the nightly crawl to twice a week**";
const spendingWithLeadIn =
  "Last week you spent CHF 412 [F2].\n\nNext build:\n**bakery: cut the nightly crawl to twice a week**\n";

check("a question about spending loses the build line", () => {
  const held = holdBuildLine(spending, "What was our spending last week?");
  assert.equal(held.buildLine, "bakery: cut the nightly crawl to twice a week");
  assert.equal(held.text.includes("**"), false);
  assert.equal(
    held.text,
    "Last week you spent CHF 412 across three projects [F2]; the bakery took CHF 260 of it [F3].",
  );
});
check("the lead-in that introduced the line goes with it", () => {
  const held = holdBuildLine(spendingWithLeadIn, "How much did we spend?");
  assert.equal(held.text, "Last week you spent CHF 412 [F2].");
  assert.equal(held.buildLine, "bakery: cut the nightly crawl to twice a week");
});
check("asked what to build next, the line stays in the answer", () => {
  const held = holdBuildLine(spending, "What should I build next?");
  assert.equal(held.buildLine, null);
  assert.equal(held.text, spending);
});
check("a create-project line is held the same way", () => {
  const held = holdBuildLine(
    "Three visitors asked for a menu page this week [F4].\n\n**create project menu and build it: a one-page menu with prices**",
    "Any feedback this week?",
  );
  assert.equal(held.buildLine, "create project menu and build it: a one-page menu with prices");
  assert.equal(held.text, "Three visitors asked for a menu page this week [F4].");
});
check("bold emphasis inside a sentence is not a build line", () => {
  const answer = "The **bakery** is live [F1], the shop is not.";
  assert.deepEqual(holdBuildLine(answer, "Which are live?"), { text: answer, buildLine: null });
});
check("two offered lines are a choice and are left alone", () => {
  const answer = "Two options [F1].\n\n**bakery: add a menu**\n**shop: fix checkout**";
  assert.deepEqual(holdBuildLine(answer, "Which are live?"), { text: answer, buildLine: null });
});
check("an answer with no bold line is unchanged", () => {
  assert.deepEqual(holdBuildLine("Not in your data.", "What was our spending?"), {
    text: "Not in your data.",
    buildLine: null,
  });
});

for (const m of [
  "What should I build next?",
  "what do you suggest",
  "What's next for the bakery?",
  "Propose something for this week",
  "Help me decide between the two",
  "I need a decision on the shop",
  "yes",
  "Ok do it",
  "Where should I focus today?",
]) {
  check(`"${m}" asks for direction`, () => assert.equal(askedForBuild(m), true));
}
for (const m of [
  "What was our spending last week?",
  "Who is Elena?",
  "Show me the latest agent run logs",
  "How many visitors did the bakery have?",
  "",
]) {
  check(`"${m}" does not`, () => assert.equal(askedForBuild(m), false));
}

check("the held line is read back from a body or a stored meta", () => {
  assert.equal(readBuildLine({ buildLine: " bakery: add a menu " }), "bakery: add a menu");
  assert.equal(readBuildLine({ buildLine: "" }), null);
  assert.equal(readBuildLine({}), null);
  assert.equal(readBuildLine(null), null);
});

console.log(`\nloki-build-line-guard: ${pass} passed`);
