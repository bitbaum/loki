// A finished run's summary, as the Loki chat shows it under the dispatch that
// started it: what changed, what was checked, and next steps that carry on in
// the same chat. Pinned: empty fields say nothing; lists split and cap; long
// agent text is clipped; and both live-status routes carry it to the card.
// Run: npx tsx scripts/test/run-handoff.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nextStepPrompt, runHandoff } from "@/lib/run-handoff";

assert.equal(runHandoff(null), null, "no summary, no handoff");
assert.equal(
  runHandoff({ done: "none", next: "N/A", tests: "not run" }),
  null,
  "a summary of empty words is no handoff — the card reads as before",
);

const h = runHandoff({
  done: "Added ?run= to Watch; widget links building rows to the run; fixed the test",
  next: "- Show the run inline in chat\n- Add a phone check\n- Tidy copy\n- A fourth",
  tests: "unit 386/386 pass; tsc clean",
});
assert.ok(h);
assert.deepEqual(h.done, [
  "Added ?run= to Watch",
  "widget links building rows to the run",
  "fixed the test",
]);
assert.deepEqual(
  h.next,
  ["Show the run inline in chat", "Add a phone check", "Tidy copy"],
  "bullet lines split, capped at three",
);
assert.equal(h.checked, "unit 386/386 pass; tsc clean");

const long = runHandoff({ done: "x".repeat(500), next: "", tests: "" });
assert.ok(long && long.done[0].length <= 240 && long.done[0].endsWith("…"), "long text clipped");
assert.deepEqual(long.next, []);
assert.equal(long.checked, null);

assert.deepEqual(runHandoff({ done: "Same; same; Same" })?.done, ["Same"], "no repeats");
assert.equal(nextStepPrompt("Add a phone check"), "Next: Add a phone check");

for (const route of [
  "src/app/api/control/commands/[id]/route.ts",
  "src/app/api/orchestration/runs/[id]/route.ts",
]) {
  assert.match(readFileSync(route, "utf8"), /handoff: runHandoff\(run/, `${route} carries it`);
}

console.log("run-handoff: ok");
