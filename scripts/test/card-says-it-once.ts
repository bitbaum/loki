/**
 * A project card must not say the same thing twice.
 *
 * From the rail, 2026-09-21: a card whose status badge read "Tab open" carried
 * the subtitle "Workspace tab open" directly beneath it. Same fact, different
 * words, on every card in that state — noise on a surface whose whole job is
 * answering one question quickly.
 *
 * A guard for this ALREADY EXISTED and was defeated by the rewording:
 *
 *   {evidenceLabel && (evidenceLabel !== stateLabel || …) && …}
 *
 * Exact equality only ever catches the one phrasing nobody was going to write
 * twice. The subtitle's job is to name what was OBSERVED — "Live agent process
 * detected", "Agent signaled ready on connected computer", "Last run
 * completed". When the only thing left to say is the badge again, the honest
 * amount to say is nothing.
 *
 * Run: npx tsx scripts/test/card-says-it-once.ts
 */
import { restatesLabel } from "@/components/control/project-card-sections";
import { STATE_DEFINITIONS, type ProjectStateKey } from "@/lib/control-states";

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

console.log("card-says-it-once:");

check("THE BUG: a reworded restatement is caught", () => {
  // The exact case from the rail. `!==` said these were different.
  assert(restatesLabel("Workspace tab open", "Tab open"), "Workspace tab open vs Tab open");
});

check("an identical label is still caught", () => {
  assert(restatesLabel("Awaiting input", "Awaiting input"), "identical");
});

check("case, order and punctuation do not rescue a restatement", () => {
  assert(restatesLabel("TAB OPEN.", "Tab open"), "case + punctuation");
  assert(restatesLabel("open tab", "Tab open"), "word order");
});

check("a subtitle that adds information is NOT suppressed", () => {
  // These are the lines worth printing; the guard must leave them alone.
  assert(!restatesLabel("Live agent process detected", "Working"), "process evidence");
  assert(!restatesLabel("Agent signaled ready on connected computer", "Awaiting input"), "ready");
  assert(!restatesLabel("Last run completed", "Tab open"), "run completed");
  assert(!restatesLabel("No recent activity", "Not running"), "no activity");
});

check("empty strings are not treated as restatements", () => {
  // An absent subtitle is already handled by the falsy check beside this one;
  // reporting "" as a restatement would be a second, confusing reason.
  assert(!restatesLabel("", "Tab open"), "empty evidence");
  assert(!restatesLabel("Tab open", ""), "empty label");
});

check("only the two deliberately-shared labels are interchangeable", () => {
  // `ready` and `orchestration_ready` both read "Ready for next step" ON
  // PURPOSE — the distinction is internal and the operator's next move is the
  // same either way. This does not assert that every state is unique, because
  // that is not true and should not be; it pins the ONE known pair so a new
  // accidental clash still fails. (The first version of this check reported
  // that pair as a defect. It is a decision, and a test does not get to
  // overrule one.)
  const keys = Object.keys(STATE_DEFINITIONS) as ProjectStateKey[];
  const allowed = new Set(["ready|orchestration_ready", "orchestration_ready|ready"]);
  const clashes: string[] = [];
  for (const a of keys) {
    for (const b of keys) {
      if (a === b || allowed.has(`${a}|${b}`)) continue;
      if (restatesLabel(STATE_DEFINITIONS[a].label, STATE_DEFINITIONS[b].label)) {
        clashes.push(
          `${a} ("${STATE_DEFINITIONS[a].label}") vs ${b} ("${STATE_DEFINITIONS[b].label}")`,
        );
      }
    }
  }
  assert(clashes.length === 0, `new interchangeable labels:\n      ${clashes.join("\n      ")}`);
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
