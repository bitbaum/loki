/**
 * The next-step chips hold still (lib/stable-steps). Report, 2026-10-15: "they
 * rapidly change, you cannot see them, and it's just terrible".
 */
import { nextShownSteps, visibleSteps } from "@/lib/stable-steps";

let passed = 0;
function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

const rules = ["Run the checks.", "Summarize what you did."];
const base = { shown: null, key: "screen A", ai: null, rules, timedOut: false, hold: false };

check("nothing yet while the model is thinking", nextShownSteps(base) === null);
const fallback = nextShownSteps({ ...base, timedOut: true });
check("the rules once the wait runs out", fallback?.steps[0] === "Run the checks.");
const ai = nextShownSteps({ ...base, ai: ["Fix the login page."] });
check("the model's steps lead when they come in time", ai?.steps[0] === "Fix the login page.");
check(
  "a late model answer does not reshuffle what is shown",
  nextShownSteps({ ...base, shown: fallback, ai: ["Something else."] }) === fallback,
);
check(
  "a new settled screen gets a new set",
  nextShownSteps({ ...base, shown: ai, key: "screen B", ai: ["Deploy it."] })?.steps[0] ===
    "Deploy it.",
);
check(
  "typing freezes the chips",
  nextShownSteps({ ...base, shown: ai, key: "screen B", ai: ["Deploy it."], hold: true }) === ai,
);
check(
  "the old set stays up while the next is chosen (no blink)",
  visibleSteps(ai, "screen B")[0] === "Fix the login page.",
);
check("nothing to answer → no chips", visibleSteps(ai, null).length === 0);

console.log(`\n${passed} passed`);
