/**
 * No caller may reach a model without naming itself.
 *
 * The capacity page was blind to fifteen features. Not because anyone hid
 * them — because `callGroqText` took an options object where the label was
 * optional, so the cheapest thing to write was the invisible thing.
 *
 * `feature` is now REQUIRED, which makes the compiler the real guard. These
 * checks defend the two ways that guard could be quietly given back:
 * re-introducing a default, and adding a new transport that skips the meter.
 *
 * Run: npx tsx scripts/test/ai-usage-coverage.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

const read = (p: string) => readFileSync(p, "utf8");
const groq = read("src/lib/groq.ts");

check("the feature label is REQUIRED — an optional one is how this broke", () => {
  assert.match(groq, /\n {2}feature: string;/, "`feature` must not be optional");
  assert.doesNotMatch(
    groq,
    /feature\?: string/,
    "an optional label lets the next caller be invisible, which is the whole bug",
  );
});

check("neither entry point defaults its options away", () => {
  // `options: GroqOptions = {}` would restore the hole: with a default, a call
  // that names nothing compiles again.
  assert.doesNotMatch(
    groq,
    /callTextDetailed\([\s\S]{0,80}options: GroqOptions = \{\}/,
    "callTextDetailed must not default its options",
  );
  assert.doesNotMatch(
    groq,
    /callGroqText\(prompt: string, options: GroqOptions = \{\}/,
    "callGroqText must not default its options",
  );
});

check("every transport that reaches a vendor records what it learned", () => {
  // One line per transport. A new one that forgets this is the failure mode
  // that made the page confidently wrong rather than visibly incomplete.
  for (const [file, why] of [
    ["src/lib/groq.ts", "the shared text client (19 callers)"],
    ["src/lib/vision.ts", "the vision chain — same vendor pools, own transport"],
    ["src/lib/agent/llm.ts", "the tool loop"],
  ] as const) {
    assert.match(
      read(file),
      /recordVendorQuota\(/,
      `${file} calls a vendor and must meter it — ${why}`,
    );
  }
});

check("a completed call is charged to a named feature", () => {
  assert.match(
    groq,
    /recordUsage\(link\.provider\.id, link\.model, feature,/,
    "provider, model AND feature — a total with no breakdown is what we already had",
  );
});

check("the ledger write can never fail an answer", () => {
  // Same contract as record-quota: lazily imported, floated, and caught.
  assert.match(groq, /void import\("@\/db\/queries\/ai-usage"\)/, "must be lazy + fire-and-forget");
  assert.match(groq, /\.catch\(\(\) => undefined\)/, "must swallow its own failure");
});

check("BOTH doors record spend, not just the one that was easy to find", () => {
  // The hole this check exists for: groq.ts was metered and called "one door".
  // It is not the door chat comes through. Every tool-loop turn — the bulk of
  // the traffic, and the only path Gemini serves — spent tokens `ai_usage`
  // never saw, so the capacity page listed background features only and a
  // vendor answering exclusively there could never appear as having served.
  for (const [file, why] of [
    ["src/lib/groq.ts", "the shared text client (19 callers)"],
    ["src/lib/agent/llm.ts", "the TOOL LOOP — most of the traffic"],
  ] as const) {
    assert.match(read(file), /recordUsage\(/, `${file} must charge its spend — ${why}`);
  }
});

check("the tool loop names its caller too", () => {
  const llm = read("src/lib/agent/llm.ts");
  assert.match(llm, /\n {2}feature: string;/, "required on ModelCallInput, same as GroqOptions");
  assert.doesNotMatch(llm, /feature\?: string/, "optional is how the first hole opened");
});

console.log(`✓ ai usage coverage: ${passed} checks passed`);
