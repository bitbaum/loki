/**
 * A key the vendor knows but cannot bill is saved, not refused.
 *
 * Pins the four verdicts a probe can mean (src/lib/own-model-verdict.ts) on
 * the exact sentence xAI sent on 2026-10-10, and that every vendor a reader
 * can bring has a billing page to be sent to.
 *
 * Run: npx tsx scripts/test/own-model-verdict.ts
 */
import assert from "node:assert/strict";
import { BYOK_VENDOR_IDS } from "@bitbaum/ai-kit/byok";
import { ownModelVerdict } from "@/lib/own-model-verdict";
import { OWN_MODEL_BILLING } from "@/config/own-model-vendors";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("own-model-verdict:");

check("xAI's 'used all available credits' is unfunded, not refused", () => {
  const message =
    'xAI didn\'t accept this key. xAI says: "Your team 4a03e23f has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit."';
  assert.equal(ownModelVerdict({ ok: false, status: 403, message }), "unfunded");
  assert.equal(ownModelVerdict({ ok: false, status: 400, message }), "unfunded");
});

check("402 is unfunded whatever the vendor wrote", () => {
  assert.equal(
    ownModelVerdict({ ok: false, status: 402, message: "Payment Required" }),
    "unfunded",
  );
});

check("OpenAI's insufficient_quota and DeepSeek's balance are unfunded", () => {
  assert.equal(
    ownModelVerdict({ ok: false, status: 429, message: 'OpenAI says: "insufficient_quota"' }),
    "unfunded",
  );
  assert.equal(
    ownModelVerdict({ ok: false, status: 402, message: "Insufficient Balance" }),
    "unfunded",
  );
});

check("a 401 is refused even when the text mentions billing", () => {
  assert.equal(
    ownModelVerdict({ ok: false, status: 401, message: "Invalid API key — check billing" }),
    "refused",
  );
});

check("a bad key is refused; a vendor we could not reach is unreachable; ok is works", () => {
  assert.equal(
    ownModelVerdict({ ok: false, status: 400, message: 'xAI says: "Incorrect API key provided"' }),
    "refused",
  );
  assert.equal(
    ownModelVerdict({ ok: false, status: null, message: "Couldn't reach" }),
    "unreachable",
  );
  assert.equal(ownModelVerdict({ ok: true, status: 200, message: "works" }), "works");
});

check("every vendor a reader can bring has a billing page and a word for its cap", () => {
  for (const id of BYOK_VENDOR_IDS) {
    const entry = OWN_MODEL_BILLING[id];
    assert.ok(entry, `${id} has no billing entry`);
    assert.match(entry.billingUrl, /^https:\/\//, `${id} billing url`);
    assert.ok(entry.limit.length > 3, `${id} limit word`);
  }
});

console.log(`\nown-model-verdict: ${passed} passed`);
