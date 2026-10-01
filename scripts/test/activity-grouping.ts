/**
 * Folding repeats on /activity (src/lib/activity-grouping.ts).
 *
 * Live 2026-10-01: four identical "usage limit is exhausted" failures listed
 * one by one, and 64 "No prompt text was recorded" rows in the feed. The fold
 * must merge what is the same and nothing else — a failure folded into the
 * wrong group is a failure nobody reads.
 *
 * Run: npx tsx scripts/test/activity-grouping.ts (or npm run test:unit)
 */
import assert from "node:assert/strict";
import type { ActivityEvent } from "@/lib/activity-events";
import {
  BARE_FOLD_MIN,
  causeKey,
  groupFailuresByCause,
  isBareDispatch,
  projectTally,
  splitBareDispatches,
} from "@/lib/activity-grouping";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

let n = 0;
function ev(over: Partial<ActivityEvent>): ActivityEvent {
  n += 1;
  return {
    id: `e${n}`,
    occurredAt: "2026-10-01T10:00:00Z",
    projectKey: "loki",
    agentLabel: "Claude",
    intentLabel: "custom",
    intentId: "custom",
    status: "neutral",
    outcome: "dispatched",
    outcomeLabel: "Sent",
    durationLabel: null,
    durationMs: null,
    ask: null,
    done: null,
    next: null,
    error: null,
    verification: null,
    isLocalChat: false,
    runId: null,
    promptId: null,
    ...over,
  };
}

const LIMIT = "claude cannot generate because its usage limit is exhausted. Switch this project.";

console.log("\ngroupFailuresByCause");

check("the same sentence on different projects is one group", () => {
  const groups = groupFailuresByCause([
    ev({ projectKey: "Farmhouse", error: LIMIT, outcome: "error" }),
    ev({ projectKey: "Skif", error: LIMIT, outcome: "error" }),
    ev({ projectKey: "Zurich Sublet", error: LIMIT, outcome: "error" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].events.length, 3);
  assert.equal(groups[0].cause, LIMIT);
});

check("different causes stay apart, the larger group first", () => {
  const groups = groupFailuresByCause([
    ev({ error: "timed out after 600s", outcome: "timeout" }),
    ev({ error: LIMIT, outcome: "error" }),
    ev({ error: LIMIT, outcome: "error" }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].cause, LIMIT);
  assert.equal(groups[1].events.length, 1);
});

check("per-run numbers and ids do not split a cause", () => {
  const a = ev({ error: "run 3f2a9c1b-1111-2222-3333-444455556666 hung after 120s" });
  const b = ev({ error: "run 9e8d7c6b-aaaa-bbbb-cccc-ddddeeeeffff hung after 340s" });
  assert.equal(causeKey(a), causeKey(b));
});

check("a failure with no reason groups under its outcome", () => {
  const groups = groupFailuresByCause([
    ev({ outcome: "hang", outcomeLabel: "Hung" }),
    ev({ outcome: "hang", outcomeLabel: "Hung" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].cause, "Hung with no recorded reason");
});

console.log("\nsplitBareDispatches");

const bare = () => ev({ ask: { missing: true } as ActivityEvent["ask"] });

check("a row that only says 'sent' is bare; one with anything else is not", () => {
  assert.equal(isBareDispatch(bare()), true);
  assert.equal(
    isBareDispatch(ev({ ask: { missing: true } as ActivityEvent["ask"], done: "x" })),
    false,
  );
  assert.equal(isBareDispatch(ev({ outcome: "success", outcomeLabel: "Done" })), false);
});

check(`fewer than ${BARE_FOLD_MIN} bare rows stay rows`, () => {
  const events = [bare(), bare(), ev({ outcome: "success", done: "shipped" })];
  const { rows, bare: folded } = splitBareDispatches(events);
  assert.equal(rows.length, 3);
  assert.equal(folded.length, 0);
});

check("a run of bare rows folds, and nothing that says something is folded", () => {
  const real = ev({ outcome: "success", done: "shipped" });
  const events = [bare(), real, bare(), bare()];
  const { rows, bare: folded } = splitBareDispatches(events);
  assert.deepEqual(
    rows.map((r) => r.id),
    [real.id],
  );
  assert.equal(folded.length, 3);
});

check("the fold names its projects, most first", () => {
  const tally = projectTally([
    ev({ projectKey: "Bitbaum" }),
    ev({ projectKey: "loki" }),
    ev({ projectKey: "loki" }),
    ev({ projectKey: "g" }),
  ]);
  assert.equal(tally, "loki ×2 · Bitbaum · g");
});

console.log(`\n${passed}/${passed} activity-grouping cases passed`);
