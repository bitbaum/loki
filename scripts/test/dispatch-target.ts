/**
 * The pre-dispatch sentence: agent, model, machine, and what the LAST run cost.
 *
 * The properties worth pinning are the ones that would turn a measurement back
 * into a claim — a predicted price, a real run rounded to free, or a stale
 * capacity wall stated as fact.
 */

import assert from "node:assert/strict";
import { describeDispatchTarget } from "@/lib/dispatch-target";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

check("the three choices read as one sentence", () => {
  const v = describeDispatchTarget({
    agentLabel: "Claude Code",
    model: "opus",
    channel: "local",
  });
  assert.equal(v.line, "Claude Code · opus · This computer");
});

check("a project that pinned no builder does not invent one", () => {
  const v = describeDispatchTarget({ agentLabel: "Claude Code", channel: null });
  assert.equal(v.line, "Claude Code");
  assert.ok(!/computer|Cloud/.test(v.line), "no machine claimed when none is pinned");
});

check("an agent with no model choice is not given an empty slot", () => {
  const v = describeDispatchTarget({ agentLabel: "Codex", model: "  ", channel: "cloud" });
  assert.equal(v.line, "Codex · Cloud builder");
});

// Cost is the PREVIOUS run's, measured. A forecast beside a button reads as a
// quote for work nobody has done.
check("a real sub-cent run never renders as free", () => {
  assert.equal(
    describeDispatchTarget({ agentLabel: "x", lastRun: { costUsd: 0.004 } }).cost,
    "<$0.01",
  );
  assert.equal(describeDispatchTarget({ agentLabel: "x", lastRun: { costUsd: 0 } }).cost, "$0.00");
  assert.equal(
    describeDispatchTarget({ agentLabel: "x", lastRun: { costUsd: 1.5 } }).cost,
    "$1.50",
  );
});

check("a run that was never priced says nothing rather than zero", () => {
  assert.equal(describeDispatchTarget({ agentLabel: "x", lastRun: { costUsd: null } }).cost, null);
  assert.equal(describeDispatchTarget({ agentLabel: "x", lastRun: null }).cost, null);
  assert.equal(describeDispatchTarget({ agentLabel: "x" }).cost, null);
});

check("a capacity wall on the last run is a caution, not a verdict", () => {
  const v = describeDispatchTarget({
    agentLabel: "Claude Code",
    lastRun: { error: "Claude usage limit reached" },
  });
  assert.ok(v.caution, "the operator is told before spending another run on it");
  assert.match(v.caution ?? "", /may still be spent/, "quota refills — it must not assert a block");
});

check("an ordinary failure is not evidence about quota", () => {
  const v = describeDispatchTarget({
    agentLabel: "Claude Code",
    lastRun: { error: "ENOENT: no such file or directory" },
  });
  assert.equal(v.caution, null, "a crash on a bad path is not an empty tank");
});

console.log(`\ndispatch-target: ${passed} checks passed`);
