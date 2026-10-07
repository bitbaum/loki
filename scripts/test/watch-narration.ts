/**
 * Watch narrates the build by itself (lib/watch-narration).
 *
 * What has to stay true for the narration to be worth showing:
 *   - an answer with no headline shows nothing, never a blank card;
 *   - "null"-ish strings from a model are absent, not printed;
 *   - it asks again only when the screen moved and 30s have passed;
 *   - a repeated headline refreshes the current beat instead of stacking.
 *
 * Run: npx tsx scripts/test/watch-narration.ts
 */
import {
  NARRATE_HISTORY,
  NARRATE_MIN_INTERVAL_MS,
  narrationPrompt,
  pushNarration,
  shouldNarrate,
} from "@/lib/watch-narration";
import { parseNarration } from "@/lib/watch-narration-parse";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

check("reads the model's JSON, fenced or not, and drops null-ish fields", () => {
  const n = parseNarration(
    '```json\n{"headline":"Adding the Team page in three languages","detail":"null","needsYou":null}\n```',
  );
  assert(n?.headline === "Adding the Team page in three languages", `headline: ${n?.headline}`);
  assert(n.detail === null, "printed the word null");
  assert(n.needsYou === null, "invented a need");
});

check("no headline, no narration", () => {
  assert(parseNarration('{"headline":"","detail":"x"}') === null, "blank headline shown");
  assert(parseNarration("I cannot see the screen.") === null, "prose shown as a headline");
});

check("long answers are cut, not overflowing a phone", () => {
  const n = parseNarration(JSON.stringify({ headline: "x".repeat(300) }));
  assert(n !== null && n.headline.length <= 90, `headline ${n?.headline.length} chars`);
});

check("asks first, then only when the screen moved and 30s passed", () => {
  const base = { screenKey: "a", lastKey: null, lastAt: null, now: 0, inFlight: false };
  assert(shouldNarrate(base), "did not ask first");
  assert(!shouldNarrate({ ...base, inFlight: true }), "asked twice at once");
  const after = { screenKey: "b", lastKey: "a", lastAt: 0, inFlight: false };
  assert(!shouldNarrate({ ...after, now: NARRATE_MIN_INTERVAL_MS - 1 }), "asked too soon");
  assert(shouldNarrate({ ...after, now: NARRATE_MIN_INTERVAL_MS }), "never asked again");
  assert(
    !shouldNarrate({ ...after, screenKey: "a", now: NARRATE_MIN_INTERVAL_MS * 5 }),
    "asked about a screen that had not moved",
  );
});

check("the story grows by new headlines only, and stays short", () => {
  const beat = (headline: string, at: number) => ({
    narration: { headline, detail: null, needsYou: null },
    at,
  });
  let story = pushNarration([], beat("Setting up the project", 1));
  story = pushNarration(story, beat("Setting up the project", 2));
  assert(story.length === 1 && story[0]!.at === 2, "a repeat stacked");
  for (let i = 0; i < 20; i++) story = pushNarration(story, beat(`Step ${i}`, 10 + i));
  assert(story.length === NARRATE_HISTORY + 1, `kept ${story.length}`);
  assert(story.at(-1)!.narration.headline === "Step 19", "lost the newest");
});

check("the prompt carries what was asked and the newest screen", () => {
  const p = narrationPrompt({
    project: "farmaciadelparco",
    asked: "Build the pharmacy site",
    previous: null,
    screen: Array.from({ length: 100 }, (_, i) => `line ${i}`),
  });
  assert(p.includes("farmaciadelparco") && p.includes("Build the pharmacy site"), "lost context");
  assert(p.includes("line 99") && !p.includes("line 0\n"), "sent the oldest screen");
});

console.log(`\n✓ watch-narration: ${passed} passed`);
