/**
 * Why a project needs you, said plainly (lib/attention-words).
 *
 * Home and Today showed "last run: needs attention" under project names — the
 * words that decide THAT a project needs you, which say nothing about WHAT
 * (owner, 2026-10-22). The run's own record says what.
 *
 * Run: npx tsx scripts/test/attention-words.ts
 */
import assert from "node:assert/strict";
import { attentionWords } from "@/lib/attention-words";

assert.equal(
  attentionWords({ error: "Claude hit its usage limit. Resets at 14:00.", runHealth: "critical" }),
  "Stopped: Claude hit its usage limit",
  "an error leads, first sentence only",
);
assert.equal(
  attentionWords({ blockReason: "Needs the Stripe key", runHealth: "needs attention" }),
  "Stuck: Needs the Stripe key",
);
assert.equal(
  attentionWords({ outcome: "partial", runHealth: "needs attention", next: "Wire the form." }),
  "The last run only got part of the way — next: Wire the form",
);
assert.equal(attentionWords({ outcome: "failed" }), "The last run failed");
assert.equal(
  attentionWords({ sessionHealth: "critical" }),
  "The agent reports something is badly wrong",
);
assert.equal(
  attentionWords({ runHealth: "needs attention" }),
  "The last run asked you to take a look",
);
assert.equal(attentionWords({}), "Needs a look");
for (const words of [
  attentionWords({ runHealth: "needs attention" }),
  attentionWords({ sessionHealth: "needs attention" }),
]) {
  assert.doesNotMatch(words, /last run: |needs attention/, words);
}
const long = attentionWords({ error: "x".repeat(300) });
assert.ok(long.length <= "Stopped: ".length + 90, "a long error is cut to one line's worth");

console.log("✓ attention-words: what happened, in words");
