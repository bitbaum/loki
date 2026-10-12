import assert from "node:assert/strict";
import {
  buildThreadTitlePrompt,
  isAutoTitle,
  parseThreadTitle,
  THREAD_TITLE_INPUT_CHARS,
  THREAD_TITLE_MAX_CHARS,
} from "../../src/lib/loki/thread-title";

// Clean replies pass through, capitalised.
assert.equal(parseThreadTitle("checkout bug on kivvi"), "Checkout bug on kivvi");
assert.equal(parseThreadTitle("Pricing page copy\n"), "Pricing page copy");

// Model habits are stripped: quotes, markdown, a label, filler, punctuation.
assert.equal(parseThreadTitle('"Deploy pipeline review"'), "Deploy pipeline review");
assert.equal(parseThreadTitle("**Zurich move plan**"), "Zurich move plan");
assert.equal(parseThreadTitle("Title: Loki rail states."), "Loki rail states");
assert.equal(parseThreadTitle("Chat about the onboarding flow"), "The onboarding flow");
assert.equal(parseThreadTitle("«Umzug nach Zürich»"), "Umzug nach Zürich");
assert.equal(parseThreadTitle("\n\n  Kivvi invoices  \nsecond line"), "Kivvi invoices");

// Nothing usable → null, so the caller keeps what the thread had.
assert.equal(parseThreadTitle(""), null);
assert.equal(parseThreadTitle("   \n  "), null);
assert.equal(parseThreadTitle("."), null);
assert.equal(
  parseThreadTitle("x".repeat(THREAD_TITLE_MAX_CHARS + 1)),
  null,
  "too long is refused, never cut mid-word",
);

// Only Loki's own titles are Loki's to replace.
const PLACEHOLDER = "New conversation";
assert.ok(isAutoTitle(PLACEHOLDER, null, PLACEHOLDER));
assert.ok(isAutoTitle("", null, PLACEHOLDER));
assert.ok(isAutoTitle("move forward on loki", "move forward on loki", PLACEHOLDER));
assert.ok(!isAutoTitle("Loki deploy fix", "move forward on loki", PLACEHOLDER), "a rename is kept");
assert.ok(!isAutoTitle("Loki deploy fix", null, PLACEHOLDER));

// The prompt names the project first and clips both sides.
const prompt = buildThreadTitlePrompt({
  question: "q".repeat(THREAD_TITLE_INPUT_CHARS + 500),
  answer: "a",
  project: "kivvi",
});
assert.ok(prompt.startsWith("Project: kivvi"));
assert.ok(!prompt.includes("q".repeat(THREAD_TITLE_INPUT_CHARS + 1)));

console.log("✓ loki thread title");
