/**
 * The Prompt box's suggestions come from what the screen shows.
 * Case from the report (2026-10-05): the screen read "PR #43 CI pending;
 * auto-merge armed … Completed" and the box offered nothing but a placeholder.
 */
import { sameSuggestions, suggestPrompts } from "@/lib/terminal-suggestions";

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

const asking = suggestPrompts(["Apply these edits?", "Do you want to proceed? (y/n)"]);
check("a question on screen → answer it first", asking[0] === "Yes, go ahead.");

const empty = suggestPrompts([]);
check("an empty screen still offers something", empty.length === 3);
check("no duplicates", new Set(empty).size === empty.length);

check("sameSuggestions compares by value", sameSuggestions(["a", "b"], ["a", "b"]));
check("sameSuggestions sees a change", !sameSuggestions(["a"], ["b"]));

console.log(`\n${passed}/${passed} terminal-suggestions cases passed`);
