/**
 * Folding the /feedback inbox (src/lib/feedback/inbox-groups.ts).
 *
 * Live 2026-10-01: 28 of 36 "Needs you" rows ended in the same sentence. The
 * fold must merge identical failures and nothing else — a report folded into
 * the wrong group is a report nobody reads.
 *
 * Run: npx tsx scripts/test/feedback-inbox-groups.ts
 */
import assert from "node:assert/strict";
import { FEEDBACK_WORK_PHASE } from "@/lib/feedback/work-phase";
import { foldSameFailures, SAME_FAILURE_MIN } from "@/lib/feedback/inbox-groups";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

const NEVER = "The agent opened but never answered — Retry runs it on the next provider.";
let n = 0;
const item = (phase: string, detail: string | null = null) => ({
  id: `f${++n}`,
  work: { phase, detail },
});

console.log("\nfoldSameFailures");

check(`${SAME_FAILURE_MIN}+ failures with one reason fold together`, () => {
  const items = [1, 2, 3, 4].map(() => item(FEEDBACK_WORK_PHASE.FAILED, NEVER));
  const { rows, folds } = foldSameFailures(items);
  assert.equal(rows.length, 0);
  assert.equal(folds.length, 1);
  assert.equal(folds[0].items.length, 4);
  assert.equal(folds[0].cause, NEVER);
});

check("stuck and failed share a fold when the reason is the same", () => {
  const items = [
    item(FEEDBACK_WORK_PHASE.FAILED, NEVER),
    item(FEEDBACK_WORK_PHASE.STUCK, NEVER),
    item(FEEDBACK_WORK_PHASE.FAILED, NEVER),
  ];
  assert.equal(foldSameFailures(items).folds[0].items.length, 3);
});

check("two of a kind stay rows", () => {
  const items = [item(FEEDBACK_WORK_PHASE.FAILED, NEVER), item(FEEDBACK_WORK_PHASE.FAILED, NEVER)];
  const { rows, folds } = foldSameFailures(items);
  assert.equal(rows.length, 2);
  assert.equal(folds.length, 0);
});

check("a report waiting for triage is never folded, whatever its detail", () => {
  const items = [
    item(FEEDBACK_WORK_PHASE.NOT_STARTED, NEVER),
    item(FEEDBACK_WORK_PHASE.NEEDS_VERIFY, NEVER),
    ...[1, 2, 3].map(() => item(FEEDBACK_WORK_PHASE.FAILED, NEVER)),
  ];
  const { rows, folds } = foldSameFailures(items);
  assert.equal(rows.length, 2);
  assert.equal(folds[0].items.length, 3);
});

check("different reasons stay apart, larger fold first, order kept inside", () => {
  const other = "Timed out after 600s.";
  const a = [1, 2, 3].map(() => item(FEEDBACK_WORK_PHASE.FAILED, other));
  const b = [1, 2, 3, 4].map(() => item(FEEDBACK_WORK_PHASE.FAILED, NEVER));
  const { folds } = foldSameFailures([...a, ...b]);
  assert.equal(folds.length, 2);
  assert.equal(folds[0].cause, NEVER);
  assert.deepEqual(
    folds[1].items.map((i) => i.id),
    a.map((i) => i.id),
  );
});

check("a failure with no reason is not folded into anything", () => {
  const items = [1, 2, 3].map(() => item(FEEDBACK_WORK_PHASE.FAILED, null));
  assert.equal(foldSameFailures(items).rows.length, 3);
});

console.log(`\n${passed}/${passed} feedback-inbox-groups cases passed`);
