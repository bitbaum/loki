/**
 * A dispatch the builder refused must not leave its run WAITING. Case from the
 * live site (2026-10-15): an account with no builder collected six "waiting"
 * runs, each one a dispatch that had already failed in front of the person.
 */
import { readFileSync } from "fs";
import { join } from "path";

const src = readFileSync(join(__dirname, "../../src/lib/inject-core.ts"), "utf8");
const failure = src.indexOf("if (!result.ok) {");
const close = src.indexOf(
  "closeRunUndelivered(runId, userId, result.error, { notify: false })",
  failure,
);
const report = src.indexOf("return recordInjectFailure(userId, result, outcome);", failure);
if (failure < 0 || close < 0 || report < 0 || !(close < report)) {
  throw new Error("✗ a refused dispatch closes its run before reporting the failure");
}
console.log("  ✓ a refused dispatch closes its run (quietly — the reply already says it failed)");
