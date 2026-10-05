/**
 * The Prompt box's suggestions come from what the screen shows.
 * Case from the report (2026-10-05): the screen read "PR #43 CI pending;
 * auto-merge armed … Completed" and the box offered nothing but a placeholder.
 */
import { sameSuggestions, suggestFromReply, suggestPrompts } from "@/lib/terminal-suggestions";

let passed = 0;
function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

const reported = suggestPrompts([
  "Working",
  "✻ Skif build out      PR #43 CI pending; auto-merge armed       6 PRs   6h",
  "Completed",
  "> describe a task for a new session",
]);
check("names the PR the screen is waiting on", reported[0]?.includes("PR #43") === true);
check(
  "offers to continue once something completed",
  reported.includes("Continue with the next most valuable step."),
);
check("never more than three", reported.length === 3);

const failing = suggestPrompts(["PR #7 checks failed: lint", "Error: Cannot find module 'x'"]);
check("failing CI → fix it", failing[0] === "Fix what is failing in CI on PR #7, then push.");
check(
  "an error on screen → fix it",
  failing.includes("Fix the error on screen, then re-run what failed."),
);

// The report that misfired (2026-10-05): an agent's summary describing errors
// it had already fixed. Prose about an error is not an error on screen.
const prose = suggestPrompts([
  "Forms now work with JavaScript turned off. The fix is in PR #43.",
  "Cause: Next's protection refused every form; submitting it returned an error",
  '("Invalid Server Actions request") and saved nothing.',
  "In the full test run, 185 of 186 tests passed. The one failure was a database test.",
]);
check(
  "prose about a fixed error → no fix-it suggestion",
  !prose.includes("Fix the error on screen, then re-run what failed."),
);
for (const line of [
  "TypeError: Cannot read properties of undefined (reading 'x')",
  "error TS2345: Argument of type 'string' is not assignable",
  "npm ERR! code ELIFECYCLE",
  " FAIL  src/server/ops-queue.test.ts > clamps a page",
  "      Tests  1 failed | 185 passed (186)",
  "Command exited with code 2",
  "Traceback (most recent call last):",
]) {
  check(
    `error output → fix it: ${line.trim().slice(0, 32)}`,
    suggestPrompts([line]).includes("Fix the error on screen, then re-run what failed."),
  );
}

const asking = suggestPrompts(["Apply these edits?", "Do you want to proceed? (y/n)"]);
check("a question on screen → answer it first", asking[0] === "Yes, go ahead.");

// The chat view reads Claude's last reply instead of a screen.
const offer = suggestFromReply(
  "Here is what I'd do next:\n1. Review the assessment pages.\n\nWant me to start on 1?",
);
check("a reply asking 'Want me to…?' → yes first", offer[0] === "Yes, go ahead.");
const report = suggestFromReply(
  "Done.\n- PR: #44\nPR #44 open, CI pending, merges via the auto-merge sweep",
);
check("a finished report naming a pending PR → watch it", report[0]?.includes("PR #44") === true);
check(
  "a plain statement is not a question",
  !suggestFromReply("I want to note one thing.").includes("Yes, go ahead."),
);

const empty = suggestPrompts([]);
check("an empty screen still offers something", empty.length === 3);
check("no duplicates", new Set(empty).size === empty.length);

check("sameSuggestions compares by value", sameSuggestions(["a", "b"], ["a", "b"]));
check("sameSuggestions sees a change", !sameSuggestions(["a"], ["b"]));

console.log(`\n${passed}/${passed} terminal-suggestions cases passed`);
