/**
 * Unit tests for the run → conversation write-back (pure half).
 *
 * Contract: a run that carries the conversation it came from gets a message
 * back into that thread on close, naming the pull request that will merge on
 * its own (or the absence of one), and the live URL. Runs without a
 * conversation, or not yet closed, produce nothing.
 *
 * Run: npx tsx scripts/test/run-outcome-format.ts
 */
import assert from "node:assert/strict";
import { formatRunOutcomeMessage } from "@/lib/orchestration/run-outcome-format";
import { ORCHESTRATION_OUTCOME } from "@/db/schema/orchestration-runs";

const base = {
  id: "run-1",
  projectKey: "loki",
  outcome: ORCHESTRATION_OUTCOME.SUCCESS as string | null,
  finishedAt: new Date("2026-09-14T00:00:00Z") as Date | null,
  payload: { conversationId: "conv-1", resultText: "Renamed the product; PR opened." } as Record<
    string,
    unknown
  >,
};

let pass = 0;
function check(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

check("no conversation → nothing to say", () => {
  assert.equal(formatRunOutcomeMessage({ ...base, payload: {} } as never), null);
});

check("not closed yet → nothing to say", () => {
  assert.equal(formatRunOutcomeMessage({ ...base, finishedAt: null } as never), null);
});

check("a successful run with a PR names it and says it merges on its own", () => {
  const m = formatRunOutcomeMessage(base as never, {
    evidence: { kind: "pr", url: "https://github.com/bitbaum/loki/pull/700", title: "x" },
    liveUrl: "https://loki.orangecat.ch",
  });
  assert.ok(m);
  assert.match(m.content, /✅ \*\*loki\*\* — done\./);
  assert.match(m.content, /Renamed the product; PR opened\./);
  assert.match(m.content, /Pull request: https:\/\/github\.com\/bitbaum\/loki\/pull\/700/);
  assert.match(m.content, /merges on its own once its checks are green/);
  assert.match(m.content, /Live: https:\/\/loki\.orangecat\.ch/);
  assert.equal(m.meta.prUrl, "https://github.com/bitbaum/loki/pull/700");
  assert.equal(m.meta.runId, "run-1");
});

check("a push without a PR is named as something that will NOT merge", () => {
  const m = formatRunOutcomeMessage(base as never, {
    evidence: { kind: "push", url: "https://github.com/bitbaum/loki/tree/feat-x", title: "x" },
  });
  assert.ok(m);
  assert.match(m.content, /Pushed: /);
  assert.match(m.content, /nothing will merge by itself/);
  assert.equal(m.meta.prUrl, null);
});

check("success with no evidence at all is flagged, not celebrated", () => {
  const m = formatRunOutcomeMessage(base as never);
  assert.ok(m);
  assert.match(m.content, /No pull request or push was found/);
});

check("evidence already on the run payload (reaper) is used", () => {
  const m = formatRunOutcomeMessage({
    ...base,
    outcome: ORCHESTRATION_OUTCOME.PARTIAL,
    payload: {
      conversationId: "conv-1",
      evidence: {
        kind: "pr",
        url: "https://github.com/bitbaum/loki/pull/701",
        title: "t",
        atMs: 1,
      },
    },
  } as never);
  assert.ok(m);
  assert.match(m.content, /🟡 \*\*loki\*\* — partly done\./);
  assert.equal(m.meta.prUrl, "https://github.com/bitbaum/loki/pull/701");
});

check("a failed run reports the error text and the outcome", () => {
  const m = formatRunOutcomeMessage({
    ...base,
    outcome: "timeout",
    payload: { conversationId: "conv-1", error: "Timed out — run exceeded maximum duration" },
  } as never);
  assert.ok(m);
  assert.match(m.content, /❌ \*\*loki\*\* — did not finish \(timeout\)\./);
  assert.match(m.content, /Timed out/);
});

check("the summary is capped so a wall of handoff text cannot flood the thread", () => {
  const m = formatRunOutcomeMessage({
    ...base,
    payload: { conversationId: "conv-1", resultText: "x".repeat(5000) },
  } as never);
  assert.ok(m);
  assert.ok(m.content.length < 1200, `content is ${m.content.length} chars`);
});

check("a run closed from a session handoff carries the agent's own words", () => {
  // The local PTY path — the one a person watches after typing into /loki —
  // never sets payload.resultText: it closes from the handoff, and the words
  // land in `summary`. This used to print a bare "🟡 partly done" and nothing
  // else, which is the trip out of the product this message exists to prevent.
  const m = formatRunOutcomeMessage({
    ...base,
    outcome: "partial",
    payload: { conversationId: "conv-1" },
    summary: {
      done: "e2e ok — no changes",
      next: "Definition of done not yet met — include a committed and pushed change.",
      tests: "not run (health probe)",
      todos: "0",
      health: "",
    },
  } as never);
  assert.ok(m);
  assert.match(m.content, /🟡 \*\*loki\*\* — partly done\./);
  assert.match(m.content, /e2e ok — no changes/);
  assert.match(m.content, /Next: Definition of done not yet met/);
});

check("a runner's own result text still wins over the handoff", () => {
  const m = formatRunOutcomeMessage({
    ...base,
    summary: { done: "handoff words", next: "", tests: "", todos: "", health: "" },
  } as never);
  assert.ok(m);
  assert.match(m.content, /Renamed the product; PR opened\./);
  assert.doesNotMatch(m.content, /handoff words/);
});

console.log(`\nrun-outcome-format: ${pass} passed`);
