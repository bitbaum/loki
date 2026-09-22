/**
 * The front door has to answer the question it exists for.
 *
 * Measured on production 2026-09-22, with /today fully expanded: the page
 * mentioned "feedback" ZERO times, "failed" ZERO times and flagged projects
 * ZERO times. What it did show was a greeting, the weather, an empty sticky
 * note, and "92 runs this week" — while the sidebar three inches to the left
 * badged "Feedback 4".
 *
 * So the page reported VOLUME and the operator had to go three clicks away to
 * learn whether he was free — and Control and Activity then answered it
 * differently from each other (Control's "7" was 5 feedback + 2 widget;
 * Activity's "7" was attention events).
 *
 * THE TWO RULES THIS PINS, both of which are about honesty rather than layout:
 *
 *   1. ONE OWNER. The verdict reads `useControlInbox` — the same hook Control's
 *      own inbox uses — so the two surfaces cannot disagree about the number.
 *      A third derivation of "needs you" is exactly how there came to be two
 *      different sevens.
 *   2. A FAILED FETCH IS NOT "NOTHING". On a page whose whole job is to be
 *      trusted when it says you are free, a request that errored must never
 *      render as the confident answer "no".
 *
 * Run: npx tsx scripts/test/today-answers-the-question.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const verdict = strip(readFileSync(join(ROOT, "src/components/today/NeedsYouVerdict.tsx"), "utf8"));
const page = strip(readFileSync(join(ROOT, "src/app/(app)/today/page.tsx"), "utf8"));
const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

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

console.log("today-answers-the-question:");

check("THE BUG: the front door renders a verdict at all", () => {
  assert(page.includes("<NeedsYouVerdict"), "/today does not render the verdict");
});

check("and renders it BEFORE the weather and the sticky note", () => {
  // The RENDER body only. Searching the whole file finds the import block,
  // where every component is named long before any of them is rendered — the
  // test then fails on alphabetised imports rather than on page order.
  const body = page.slice(page.indexOf("export default async function TodayPage"));
  const at = body.indexOf("<NeedsYouVerdict");
  assert(at !== -1, "the verdict is imported but never rendered");
  for (const later of ["<WeatherCard", "<StickyNoteCard"]) {
    const other = body.indexOf(later);
    if (other === -1) continue;
    assert(at < other, `${later} is rendered before the verdict — volume above need`);
  }
});

check("RULE 1: one owner — it reuses Control's inbox hook", () => {
  assert(
    verdict.includes("useControlInbox"),
    "the verdict derives its own count instead of reading the shared one — that is how two different sevens happened",
  );
  assert(
    !/useFetch\(["'`]\/api\/feedback/.test(verdict),
    "the verdict fetches feedback directly, bypassing the shared hook",
  );
});

check("RULE 2: a failed fetch is never an all-clear", () => {
  assert(verdict.includes("loadFailed"), "the verdict ignores the failure flag");
  const at = verdict.indexOf("loadFailed");
  const branch = verdict.slice(at, at + 600);
  assert(
    /could not check|couldn't check/i.test(branch),
    "a failed load does not say so — it will read as 'nothing needs you'",
  );
  assert(
    /not an all-clear|try again/i.test(branch),
    "the failure state offers no recovery and does not disclaim itself",
  );
  // The calm state must be reachable only AFTER the failure branch returns.
  assert(
    verdict.indexOf("loadFailed") < verdict.indexOf("Nothing needs you"),
    "the all-clear is rendered before the failure is checked",
  );
});

check("an empty queue is SAID, not left blank", () => {
  // A page that shows nothing when nothing is wrong teaches you to distrust
  // its silence.
  assert(verdict.includes("Nothing needs you"), "the calm state renders no sentence");
});

check("flagged projects are NAMED with their own words", () => {
  assert(page.includes("hasProjectAttention"), "flags use a different predicate than the list");
  assert(page.includes("signalHasExpired"), "an expired flag would still be counted here");
  assert(
    /reason/.test(verdict) && /p\.name/.test(verdict),
    "the verdict shows a count rather than the project and what it says",
  );
});

check("the calm state carries no box and no colour", () => {
  // Principles 2 and 3: only the alarm earns an edge, and the only tint is the
  // warning rule.
  const at = css.indexOf(".ui-verdict {");
  assert(at !== -1, "the verdict has no style");
  const block = css.slice(at, css.indexOf("}", at));
  assert(
    !/border|bg-/.test(block),
    `the calm verdict is boxed or tinted: ${block.replace(/\s+/g, " ")}`,
  );
  assert(css.includes(".ui-verdict-alert"), "the alert state has no distinct style");
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
