/**
 * The "Brief Loki" prompt, pinned.
 *
 * Both bugs this covers were invisible for the same reason: a mangled prompt
 * still reads as roughly sensible prose, so it looks like a wording choice
 * rather than a defect. Neither threw, neither logged. They were found by
 * reading the field's value in a browser on 2026-09-18.
 *
 * Run: npx tsx scripts/test/today-brief.ts
 */
import { buildTodayBriefPrompt, TODAY_BRIEF_QUESTION } from "@/lib/today-brief";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const NO_COUNTS = {
  activeGoals: 0,
  avgGoalProgress: 0,
  habitsDone: 0,
  habitsTotal: 0,
  goalsDueSoon: 0,
  stuckGoals: 0,
  eventsDueSoon: 0,
  overdueCommitments: 0,
  staleContacts: 0,
  pendingDrafts: 0,
  urgentAlerts: 0,
};
const NO_FLEET = { running: 0, waiting: 0, degraded: 0 };
const HEADING = "Daily brief — Friday, 18 September";

console.log("today-brief:");

check("the heading never runs into the question", () => {
  // THE BUG, pinned. `.filter(Boolean)` dropped the intentional "" separators
  // because an empty string is falsy, so with the private zone locked (every
  // count zero) the prompt collapsed to heading-then-question with nothing
  // between them. Rendered into an <input>, which strips newlines, it read
  // "…18 SeptemberWhat should I focus on today?".
  const out = buildTodayBriefPrompt(HEADING, NO_COUNTS, NO_FLEET);
  assert(!out.includes("SeptemberWhat"), "heading and question must not concatenate");
  assert(out.includes("\n"), "the prompt is multi-line by construction");
  assert(out.startsWith(HEADING), "heading leads");
  assert(out.endsWith(TODAY_BRIEF_QUESTION), "question closes");
});

check("an empty day still separates its two parts by a blank line", () => {
  const out = buildTodayBriefPrompt(HEADING, NO_COUNTS, NO_FLEET);
  assert(out === `${HEADING}\n\n${TODAY_BRIEF_QUESTION}`, `unexpected shape: ${JSON.stringify(out)}`);
});

check("no run of blank lines, however many counts are absent", () => {
  // Keeping both separators would open the prompt with a gap when the middle
  // is empty. One collapse rule, rather than a condition per line.
  const out = buildTodayBriefPrompt(HEADING, NO_COUNTS, NO_FLEET);
  assert(!/\n{3,}/.test(out), "three or more consecutive newlines");
});

check("present counts sit between the heading and the question", () => {
  const out = buildTodayBriefPrompt(
    HEADING,
    { ...NO_COUNTS, activeGoals: 3, avgGoalProgress: 40, habitsTotal: 2, habitsDone: 1 },
    NO_FLEET,
  );
  const lines = out.split("\n");
  assert(lines[0] === HEADING, "heading first");
  assert(lines[1] === "", "blank line after the heading");
  assert(out.includes("Goals: 3 active, 40% average progress"), "goal counts present");
  assert(out.includes("Habits: 1/2 done today"), "habit counts present");
  assert(out.endsWith(TODAY_BRIEF_QUESTION), "question last");
  assert(!/\n{3,}/.test(out), "no gap runs");
});

check("a zero count contributes no line at all", () => {
  // The original `.filter(Boolean)` was right about this half, and the fix must
  // not regress it: absent counts are dropped, not rendered as "Goals: 0".
  const out = buildTodayBriefPrompt(HEADING, NO_COUNTS, NO_FLEET);
  assert(!out.includes("Goals:"), "no goals line when there are none");
  assert(!out.includes("Habits:"), "no habits line when there are none");
  assert(!out.includes("Agent fleet:"), "no fleet line when the fleet is quiet");
});

check("the fleet line names only what is actually happening", () => {
  const out = buildTodayBriefPrompt(HEADING, NO_COUNTS, { running: 2, waiting: 0, degraded: 1 });
  assert(out.includes("Agent fleet: 2 running, 1 degraded"), "running + degraded, no empty waiting");
  assert(!out.includes("waiting"), "a zero bucket must not be listed");
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
