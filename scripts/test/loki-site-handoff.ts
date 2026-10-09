/**
 * The widget's "Continue in Loki" thread arrives as context, not as a message
 * dumped into the composer.
 *
 * Run: npx tsx scripts/test/loki-site-handoff.ts
 */
import assert from "node:assert/strict";
import {
  handoffAsk,
  handoffAttachment,
  handoffSummary,
  handoffTurns,
  parseSiteHandoff,
} from "../../src/lib/loki/site-handoff";
import { handoffText } from "../../widget/continue";

// The exact block the widget builds — the two ends must agree.
const block = handoffText(
  [
    {
      kind: "noticed",
      at: 1,
      text: "Looking at this page, one thing stands out:\n• 16 piece(s) of text are under 12px",
      fix: "x",
    },
    { kind: "you", at: 2, text: "Why is this a problem, and how would you fix it?" },
    { kind: "loki", at: 3, text: "Small text is hard to read on a phone." },
  ],
  { title: "Loki", url: "https://loki.orangecat.ch/" },
);
const h = parseSiteHandoff(block);
assert.ok(h, "the widget's block is recognised");
assert.equal(h.source, "Loki");
assert.equal(h.url, "https://loki.orangecat.ch/");
assert.equal(h.turns, 3);
assert.equal(h.lastAsk, "Why is this a problem, and how would you fix it?");
assert.equal(handoffSummary(h), "loki.orangecat.ch · 3 messages");
assert.equal(handoffAttachment(h).content, block, "the model reads the whole thing");
// The empty-box send names the site and the question: it is the thread's title.
assert.equal(
  handoffAsk(h),
  "On loki.orangecat.ch: Why is this a problem, and how would you fix it?",
);
assert.equal(
  handoffAsk({ ...h, lastAsk: null }),
  "Pick up where we left off on loki.orangecat.ch.",
);
assert.ok(handoffAsk({ ...h, lastAsk: "x".repeat(400) }).length < 150, "a long ask is clipped");

const turns = handoffTurns(h);
assert.deepEqual(
  turns.map((t) => t.who),
  ["noticed", "you", "loki"],
);
assert.match(turns[0].text, /\n• 16 piece/, "a remark's second line stays with it");

// Anything else in ?q= is an ordinary prefill.
assert.equal(parseSiteHandoff("Add a pricing page"), null);
assert.equal(parseSiteHandoff(""), null);
assert.equal(parseSiteHandoff("From Loki on “x” (javascript:alert(1)):"), null, "http(s) only");

console.log("✓ loki site hand-off: context, not a composer dump");
