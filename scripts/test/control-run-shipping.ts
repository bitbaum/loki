/**
 * The Control card's shipping line: a run's outcome grades the attempt, the fix
 * ledger grades the change. These pin the cases where showing only the first one
 * misled an operator.
 */

import {
  describeRunShipping,
  normalizeRunShipping,
  shippingLanded,
  type RunShipping,
} from "@/lib/control-run-shipping";
import { FIX_SHIP_STATE } from "@/lib/feedback/fix-shipping";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function runTests(): void {
  let passed = 0;
  const check = (label: string, fn: () => void) => {
    fn();
    passed += 1;
    console.log(`  ✓ ${label}`);
  };

  // The reported bug: a feedback run delivered #757 and its record ended
  // `partial`. The outcome is not wrong — it grades the attempt, and it is
  // stamped at close, before the merge and the deploy exist. What was missing
  // is that nothing on Control said the change had since shipped.
  check("a run that shipped says so, whatever its outcome was", () => {
    const line = describeRunShipping({ state: FIX_SHIP_STATE.DEPLOYED, prNumber: 757 });
    assert(line === "#757 merged and deployed", `got "${line}"`);
  });

  check("a merged change with no deploy does not claim to be live", () => {
    const line = describeRunShipping({ state: FIX_SHIP_STATE.MERGED, prNumber: 757 });
    assert(line !== null && !line.includes("deployed"), `must not claim deployed, got "${line}"`);
    assert(line!.includes("merged"), `should say merged, got "${line}"`);
  });

  check("an open PR is reported as not live yet", () => {
    const line = describeRunShipping({ state: FIX_SHIP_STATE.PR_OPEN, prNumber: 12 });
    assert(line === "#12 open — not live yet", `got "${line}"`);
  });

  check("a failed deploy is not silently read as merged-and-done", () => {
    const line = describeRunShipping({
      state: FIX_SHIP_STATE.DEPLOY_FAILED,
      prNumber: 9,
      deployName: "Deploy",
    });
    assert(line !== null && line.includes("failed"), `must say failed, got "${line}"`);
  });

  // States that add nothing a reader could act on stay silent rather than
  // printing a line that repeats what the outcome already implied.
  check("no_evidence and pushed earn no line", () => {
    assert(describeRunShipping({ state: FIX_SHIP_STATE.NO_EVIDENCE }) === null, "no_evidence");
    assert(describeRunShipping({ state: FIX_SHIP_STATE.PUSHED }) === null, "pushed");
    assert(describeRunShipping(null) === null, "absent ledger");
  });

  // "no commit" is read off the run's own handoff. A merged, deployed pull
  // request outranks it — the work landed whatever the handoff wrote down.
  check("only a deployed change outranks the no-commit warning", () => {
    assert(shippingLanded({ state: FIX_SHIP_STATE.DEPLOYED }), "deployed landed");
    assert(!shippingLanded({ state: FIX_SHIP_STATE.MERGED }), "merged is not yet live");
    assert(!shippingLanded({ state: FIX_SHIP_STATE.PR_OPEN }), "an open PR is not live");
    assert(!shippingLanded(undefined), "no ledger is not proof of anything");
  });

  // payload is jsonb: `state` arrives as a bare string. An unknown one must
  // drop the block, never reach the operator as a raw value.
  check("an unknown ledger state is dropped, not rendered", () => {
    assert(normalizeRunShipping({ state: "teleported" }) === undefined, "unknown state");
    assert(normalizeRunShipping({ state: 7 }) === undefined, "non-string state");
    assert(normalizeRunShipping(null) === undefined, "null");
    assert(normalizeRunShipping("deployed") === undefined, "bare string is not a ledger");
  });

  check("a real ledger keeps the facts the card renders", () => {
    const fix = normalizeRunShipping({
      state: FIX_SHIP_STATE.DEPLOYED,
      pr: { number: 757, url: "https://github.com/bitbaum/loki/pull/757", title: "x" },
      deploy: { name: "Deploy", conclusion: "success", status: "completed" },
      checkedAt: new Date().toISOString(),
    }) as RunShipping;
    assert(fix?.prNumber === 757, "pr number");
    assert(fix.prUrl === "https://github.com/bitbaum/loki/pull/757", "pr url");
    assert(fix.deployName === "Deploy", "deploy name");
  });

  console.log(`\n${passed}/${passed} passed`);
}

runTests();
