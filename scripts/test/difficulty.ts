/**
 * How hard is this turn — the judgement Auto makes before it spends.
 *
 * Pins: an explicit ask wins; a greeting, a capture and a lookup are light;
 * code, a judgement call, a professional domain and a long brief are heavy;
 * one sign alone is standard; a long conversation behind a short message
 * keeps it off light; the reason is a sentence a footer can show.
 *
 * Run: npx tsx scripts/test/difficulty.ts
 */
import assert from "node:assert/strict";
import { difficultyOf } from "@/lib/models/difficulty";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const level = (m: string, history: Array<{ role: string; content: string }> = []) =>
  difficultyOf(m, history).level;

console.log("difficulty:");

check("light: greetings, captures, lookups, short questions", () => {
  assert.equal(level("hi"), "light");
  assert.equal(level("thanks!"), "light");
  assert.equal(level("add milk to my list"), "light");
  assert.equal(level("remind me to call Anna tomorrow"), "light");
  assert.equal(level("what time is it in Tokyo?"), "light");
  assert.equal(level("what's the weather like"), "light");
  assert.equal(level("how many projects do I have"), "light");
  assert.equal(level("define serendipity"), "light");
  assert.match(difficultyOf("hi").reason, /greeting/);
});

check("heavy: code, a judgement call, a professional domain, a long brief", () => {
  assert.equal(
    level("Here is the stack trace, can you debug it:\n```\nTypeError: x is undefined\n```"),
    "heavy",
  );
  assert.equal(level("What do you think of this strategy, and what are the trade-offs?"), "heavy");
  assert.equal(
    level("Review this contract clause for GDPR compliance and summarise the risks."),
    "heavy",
  );
  assert.equal(
    level("Compare the two architectures and evaluate which scales better for us."),
    "heavy",
  );
  const brief = "We are building a marketplace for repair technicians. ".repeat(35);
  assert.equal(level(brief), "heavy");
  assert.equal(
    level("1. rename the table\n2. add the index\n3. backfill\n4. switch reads\n"),
    "standard",
    "a list is one sign",
  );
});

check("one sign alone is standard; an ordinary ask of middling length is standard", () => {
  assert.equal(level("Write a short note to the team about Friday."), "standard");
  assert.equal(
    level(
      "Can you summarise what happened with the deploy yesterday and whether anything is still broken on the box? I was away and want to know where things stand before standup.",
    ),
    "standard",
  );
});

check("the person's own words win: 'think hard' is heavy, 'quick' is light", () => {
  assert.equal(level("quick: is the box up?"), "light");
  assert.equal(level("just tell me the port number"), "light");
  assert.equal(level("hi — think carefully about this one: should we move to Hetzner?"), "heavy");
  assert.equal(level("think it through step by step"), "heavy");
  assert.match(difficultyOf("think hard").reason, /care/);
});

check("a long conversation behind a short message keeps it off light", () => {
  const long = [{ role: "user", content: "x".repeat(20_000) }];
  assert.equal(level("and the second one?", long), "standard");
  assert.equal(level("and the second one?"), "light");
});

console.log(`\ndifficulty: ${passed} passed`);
