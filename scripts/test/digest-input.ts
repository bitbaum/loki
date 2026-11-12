/**
 * What the report is actually told.
 *
 * The generated reports read as vague filler for a structural reason, not a
 * prompt-tuning one: buildUserPrompt fed the model `timeline` PROMPT bodies
 * only. For every assembled dispatch that body was the literal placeholder
 * "…assembled operator dispatch (brief + goals + autopilot rules; full text
 * hidden)", and the model never saw a single run outcome, duration or error.
 * It was summarising a string that said nothing, about work it could not see.
 *
 * These cases pin the input: real asks, real outcomes, real failure causes,
 * failures first.
 *
 * Run: npx tsx scripts/test/digest-input.ts (or npm run test:unit)
 */
import assert from "node:assert/strict";
import { buildActivityEvents } from "@/lib/activity-events";
import { buildDigestUserPrompt } from "@/lib/digest-input";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ${label}`);
};

const ENVELOPE =
  "# Loki operator dispatch\n" +
  "Everything in this message is assembled by Loki's dispatch pipeline.\n\n" +
  "Project context & goals (what this project is trying to achieve):\n" +
  "Truthseeker verifies claims.\n" +
  "Favor the next step that most advances these goals.\n\n" +
  "Work on the project at /home/u/truthseeker.\n\n" +
  "Rebuild the claim-scoring index.\n\n" +
  "## Exit contract (operator requirement)\nBefore stopping, write the handoff.";

// The exact situation from the 2026-08-26 phone report.
const events = buildActivityEvents({
  prompts: [
    {
      id: "p1",
      projectKey: "truthseeker",
      adapter: "claude",
      intent: "next_best",
      customPrompt: null,
      resolvedPrompt: ENVELOPE,
      dispatchedAt: new Date("2026-08-26T05:00:00Z"),
    },
  ],
  runs: [
    {
      id: "r1",
      projectKey: "truthseeker",
      adapter: "claude",
      intent: "next_best",
      state: "error",
      outcome: "timeout",
      summary: null,
      payload: { error: "exceeded max duration" },
      startedAt: new Date("2026-08-26T05:00:00Z"),
      finishedAt: new Date("2026-08-26T06:00:00Z"),
    },
    {
      id: "r2",
      projectKey: "printcraft",
      adapter: "claude",
      intent: "next_best",
      state: "done",
      outcome: "success",
      summary: { done: "Added duplex printing support", next: "Wire the settings toggle" },
      payload: null,
      startedAt: new Date("2026-08-26T04:00:00Z"),
      finishedAt: new Date("2026-08-26T04:12:00Z"),
    },
    {
      id: "r3",
      projectKey: "sbb-lost-found",
      adapter: "claude",
      intent: "next_best",
      state: "running",
      outcome: null,
      summary: null,
      payload: null,
      startedAt: new Date("2026-08-26T04:00:00Z"),
      finishedAt: null,
    },
  ],
  blockedReasons: new Map([
    ["r1", "injected to running claude (pty), but the agent isn't generating yet"],
  ]),
  // r3 was sent ten minutes before "now": still on its way, so running.
  nowMs: Date.parse("2026-08-26T04:10:00Z"),
});

const prompt = buildDigestUserPrompt({ events, projectKey: null, windowLabel: "day" });

console.log("buildDigestUserPrompt");

check("the old placeholder never reaches the model again", () => {
  assert.ok(
    !/full text hidden/i.test(prompt),
    "the 'assembled operator dispatch … full text hidden' placeholder leaked into the report input",
  );
});

check("the model sees the REAL ask, unwrapped from its envelope", () => {
  assert.ok(prompt.includes("Rebuild the claim-scoring index"), prompt);
  // and none of the envelope's background
  assert.ok(!prompt.includes("Favor the next step"), "project-brief background leaked");
  assert.ok(!prompt.includes("Exit contract"), "exit contract leaked");
});

check("the model sees the real failure cause, not the circular timeout text", () => {
  assert.ok(prompt.includes("isn't generating yet"), prompt);
});

check("failures are listed FIRST, before successes", () => {
  const failedAt = prompt.indexOf("FAILED OR STALLED");
  const completedAt = prompt.indexOf("COMPLETED");
  assert.ok(failedAt >= 0, "expected a failures section");
  assert.ok(completedAt >= 0, "expected a completed section");
  assert.ok(failedAt < completedAt, "failures must come first — that is what a report is for");
});

check("outcomes, durations and agent-reported work all reach the model", () => {
  assert.ok(prompt.includes("Timed out"), "outcome label missing");
  assert.ok(prompt.includes("1h 0m"), "duration missing");
  assert.ok(prompt.includes("Added duplex printing support"), "reported work missing");
});

check("agent-recorded next steps are passed through, attributed", () => {
  assert.ok(prompt.includes("AGENT-RECORDED NEXT STEPS"), prompt);
  assert.ok(prompt.includes("printcraft: Wire the settings toggle"), prompt);
});

check("in-flight work is reported as in-flight", () => {
  assert.ok(prompt.includes("STILL RUNNING"), prompt);
  assert.ok(prompt.includes("sbb-lost-found"), prompt);
});

check("the totals line reflects triage buckets, not raw row counts", () => {
  assert.ok(/1 need attention/.test(prompt), prompt.split("\n")[1]);
  assert.ok(/1 completed/.test(prompt), prompt.split("\n")[1]);
  assert.ok(/1 still running/.test(prompt), prompt.split("\n")[1]);
});

check("an empty window produces a short input, not a padded one", () => {
  const empty = buildDigestUserPrompt({ events: [], projectKey: null, windowLabel: "day" });
  assert.ok(!empty.includes("FAILED OR STALLED"));
  assert.ok(!empty.includes("COMPLETED"));
  assert.ok(empty.includes("0 actions"), empty);
});

check("a project filter is stated so the model scopes its language", () => {
  const scoped = buildDigestUserPrompt({ events, projectKey: "truthseeker", windowLabel: "week" });
  assert.ok(scoped.includes('filtered to project "truthseeker"'), scoped.split("\n")[0]);
  assert.ok(scoped.includes("last week"), scoped.split("\n")[0]);
});

console.log(`\n${passed}/${passed} digest-input cases passed`);
