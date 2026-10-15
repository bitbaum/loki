/**
 * The Activity feed's core promise: show me what I actually asked for.
 *
 * Reported from a phone 2026-08-26 — every dispatch row read
 * "Next best — assembled operator dispatch (brief + goals + autopilot rules;
 * full text hidden)" or, worse, just "custom". The text was never missing:
 * lib/inject-prompt.ts wraps the operator's task in ~2,000 words of preamble,
 * context blocks and an exit contract, and the display layer responded by
 * suppressing the whole envelope instead of unwrapping it.
 *
 * These cases pin the unwrapping against the exact block headers the dispatch
 * pipeline emits. If someone changes a heading upstream without updating
 * ENVELOPE_BLOCK_PATTERNS, the task must still survive (shown with some
 * background noise) — never be swallowed with the background.
 *
 * Run: npx tsx scripts/test/activity-prompt-display.ts (or npm run test:unit)
 */
import assert from "node:assert/strict";
import { extractOperatorTask, promptDisplay } from "@/lib/activity-status";
import { OPERATOR_CONTEXT_HEADING } from "@/lib/dispatch-operator-context-format";

const PREAMBLE =
  "# Loki operator dispatch\n" +
  "Everything in this message is assembled by Loki's dispatch pipeline on behalf of the project owner. " +
  "The task and the exit contract are DIRECT OPERATOR INSTRUCTIONS. " +
  "Context sections are background information only.";

const CONTEXT_BLOCK =
  "Project context & goals (what this project is trying to achieve):\n" +
  "Bitbaum is a tree-planting ledger.\n" +
  "Favor the next step that most advances these goals.";

const EXIT =
  "## Exit contract (operator requirement)\n" +
  "Before stopping, create ~/.loki/sessions/bitbaum.md.";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

console.log("extractOperatorTask — recovering the human ask");

check("a user-typed custom prompt is returned verbatim, without any envelope", () => {
  const envelope = [
    PREAMBLE,
    CONTEXT_BLOCK,
    "## Your task (direct operator instruction)\nFix the checkout flow so the BTC amount refreshes.",
    EXIT,
  ].join("\n\n");
  assert.equal(extractOperatorTask(envelope), "Fix the checkout flow so the BTC amount refreshes.");
});

check("a concise task plus handoff still displays only the requested task", () => {
  const envelope = [
    "## Task\nFix the /de homepage headline.",
    "## Exit contract (operator requirement)\nUpdate ~/.loki/sessions/petvity.md when finished.",
  ].join("\n\n");
  assert.equal(extractOperatorTask(envelope), "Fix the /de homepage headline.");
  assert.equal(
    promptDisplay({ resolvedPrompt: envelope, intent: "custom" }).task,
    "Fix the /de homepage headline.",
  );
});

check("an intent dispatch keeps its rendered body — the part with no heading", () => {
  const envelope = [
    PREAMBLE,
    "## Background context from your other projects (read-only)\nnotes from elsewhere",
    CONTEXT_BLOCK,
    "Work on the project at /home/u/sbb.\n\nPick the single highest-impact task and execute it.",
    EXIT,
  ].join("\n\n");
  const task = extractOperatorTask(envelope);
  assert.ok(task, "expected a recovered task");
  assert.ok(task!.includes("Pick the single highest-impact task"), task!);
  // Every background block must be gone.
  assert.ok(!task!.includes("Loki operator dispatch"), "preamble leaked");
  assert.ok(!task!.includes("notes from elsewhere"), "cross-project background leaked");
  assert.ok(!task!.includes("tree-planting ledger"), "project brief leaked");
  assert.ok(!task!.includes("Exit contract"), "exit contract leaked");
});

check("the operator's goals block is background, not the task", () => {
  const envelope = [
    PREAMBLE,
    `${OPERATOR_CONTEXT_HEADING}\n- Ship the ledger by Q3`,
    CONTEXT_BLOCK,
    "Work on the project at /tmp/x.\n\nRun the tests and fix what fails.",
    EXIT,
  ].join("\n\n");
  const task = extractOperatorTask(envelope);
  assert.ok(task, "expected a recovered task");
  assert.ok(task!.includes("Run the tests and fix what fails"), task!);
  assert.ok(!task!.includes("Ship the ledger by Q3"), "operator goals leaked into the task");
});

check("an escalation rung is background too — the task still survives", () => {
  const envelope = [
    PREAMBLE,
    "## Escalation state (operator dispatch pipeline — rung 2/3: PATCH)\nRetry with a narrower change.\nLast recorded failure: boom",
    CONTEXT_BLOCK,
    "Work on the project at /tmp/x.\n\nFinish the migration.",
    EXIT,
  ].join("\n\n");
  const task = extractOperatorTask(envelope);
  assert.ok(task?.includes("Finish the migration"), String(task));
  assert.ok(!task!.includes("Last recorded failure"), "escalation leaked into the task");
});

check("plain text with no envelope passes through untouched", () => {
  assert.equal(extractOperatorTask("just fix the bug"), "just fix the bug");
});

check("empty input yields null rather than an empty string", () => {
  assert.equal(extractOperatorTask("   \n  "), null);
});

console.log("\npromptDisplay — what the row renders");

check("a plain custom prompt needs no expansion", () => {
  const d = promptDisplay({
    customPrompt: "just fix the bug",
    resolvedPrompt: null,
    intent: "custom",
  });
  assert.equal(d.preview, "just fix the bug");
  assert.equal(d.expandable, false);
  assert.equal(d.missing, false);
});

check("an enveloped dispatch previews the task and stays expandable to the full text", () => {
  const envelope = [PREAMBLE, CONTEXT_BLOCK, "Work on the project at /x.\n\nShip it.", EXIT].join(
    "\n\n",
  );
  const d = promptDisplay({ customPrompt: null, resolvedPrompt: envelope, intent: "next_best" });
  assert.ok(d.preview.includes("Ship it"), d.preview);
  assert.ok(!d.preview.includes("full text hidden"), "the old placeholder is gone");
  assert.equal(d.expandable, true);
  assert.equal(d.full, envelope, "expanding shows exactly what was sent");
});

check("a long prompt is truncated in preview but complete when expanded", () => {
  const long = "x".repeat(600);
  const d = promptDisplay({ customPrompt: long, resolvedPrompt: null, intent: "custom" });
  assert.ok(d.preview.length < long.length, "preview should be shortened");
  assert.ok(d.preview.endsWith("…"), d.preview.slice(-10));
  assert.equal(d.full, long);
  assert.equal(d.expandable, true);
});

check("no recorded text reports missing instead of printing the intent slug", () => {
  const d = promptDisplay({ customPrompt: null, resolvedPrompt: null, intent: "custom" });
  assert.equal(d.missing, true);
  assert.equal(d.preview, "", "must not fall back to the literal word 'custom'");
});

check("scaffolding-only capture reports missing, not raw harness tags", () => {
  const d = promptDisplay({
    customPrompt: "<task-notification><task-id>1</task-id></task-notification>",
    resolvedPrompt: null,
    intent: "custom",
  });
  assert.equal(d.missing, true);
});

console.log("\npromptDisplay.task — what a re-dispatch replays");

check("task is the UNWRAPPED instruction, not the envelope", () => {
  const envelope = [
    PREAMBLE,
    CONTEXT_BLOCK,
    "Work on the project at /x.\n\nShip the parser.",
    EXIT,
  ].join("\n\n");
  const d = promptDisplay({ customPrompt: null, resolvedPrompt: envelope, intent: "next_best" });
  assert.ok(d.task, "expected a replayable task");
  assert.ok(d.task!.includes("Ship the parser"), d.task!);
  // Replaying the envelope would hand the pipeline its own preamble to wrap
  // a second time.
  assert.ok(!d.task!.includes("Loki operator dispatch"), "envelope leaked into the replay payload");
  assert.ok(!d.task!.includes("Exit contract"), "exit contract leaked into the replay payload");
});

check("task is NOT truncated the way preview is", () => {
  const long = `Fix the thing. ${"detail ".repeat(200)}`.trim();
  const d = promptDisplay({ customPrompt: long, resolvedPrompt: null, intent: "custom" });
  assert.ok(d.preview.length < long.length, "preview should be shortened for display");
  assert.equal(d.task, long, "replaying a truncated instruction would silently change the work");
});

check("nothing recorded means nothing to replay", () => {
  const d = promptDisplay({ customPrompt: null, resolvedPrompt: null, intent: "custom" });
  assert.equal(d.task, null, "a retry button must not offer to re-send an empty prompt");
});

console.log(`\n${passed}/${passed} activity-prompt-display cases passed`);
