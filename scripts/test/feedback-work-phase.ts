// Pure tests for the feedback work-phase honesty layer.
//
// Regression pins:
// 1. DISPATCHED + NO run record is STUCK (retryable, poll stops), never a
//    perpetual QUEUED — the run row is created before the status flips, so
//    "no record" always means failed-create or pruned.
// 2. A SUCCESS/PARTIAL closed run is NEEDS_VERIFY ("Finished" until the fix ledger says where the PR is), never Done.
//    Done is only FEEDBACK_STATUS.RESOLVED (operator Resolve / live stamp).
//    Calling Done on inject-or-run-finish alone is the closed-loop lie.
import assert from "node:assert/strict";
import { findInjectProject } from "../../src/lib/inject-project";
import {
  composeFeedbackFixPrompt,
  composeFeedbackBatchFixPrompt,
} from "../../src/lib/feedback/compose-dispatch";
import {
  deriveFeedbackWork,
  workElapsedLabel,
  FEEDBACK_WORK_PHASE,
  type FeedbackRunSnapshot,
} from "../../src/lib/feedback/work-phase";
import { FEEDBACK_STATUS } from "../../src/lib/constants/statuses";
import { ORCH_STATE, ORCHESTRATION_OUTCOME } from "../../src/lib/orchestration/contract";
import { livePageHref } from "../../src/lib/feedback/fix-shipping";
import { feedbackInjectAccepted } from "../../src/lib/feedback/dispatch-accept";

function snap(over: Partial<FeedbackRunSnapshot>): FeedbackRunSnapshot {
  return {
    id: "run-1",
    state: ORCH_STATE.WAITING,
    outcome: null,
    startedAt: new Date(),
    finishedAt: null,
    deliveredAt: null,
    lastProgressAt: null,
    error: null,
    ...over,
  };
}

// Terminal statuses ignore the run entirely.
assert.equal(
  deriveFeedbackWork(FEEDBACK_STATUS.ARCHIVED, null).phase,
  FEEDBACK_WORK_PHASE.ARCHIVED,
);
assert.equal(deriveFeedbackWork(FEEDBACK_STATUS.RESOLVED, null).phase, FEEDBACK_WORK_PHASE.DONE);
assert.equal(deriveFeedbackWork(FEEDBACK_STATUS.NEW, null).phase, FEEDBACK_WORK_PHASE.NOT_STARTED);

// THE regression pin: dispatched + no run record = STUCK, not queued.
const runless = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, null);
assert.equal(
  runless.phase,
  FEEDBACK_WORK_PHASE.STUCK,
  "run-less dispatched row must be STUCK (retryable)",
);

// Live states — RUNNING alone is not Working; Working needs a fresh PTY heartbeat.
assert.equal(
  deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, snap({ state: ORCH_STATE.RUNNING })).phase,
  FEEDBACK_WORK_PHASE.QUEUED,
  "RUNNING with no delivery yet is Starting/Queued, not Working",
);
assert.equal(
  deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({
      state: ORCH_STATE.RUNNING,
      deliveredAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    }),
  ).phase,
  FEEDBACK_WORK_PHASE.STUCK,
  "RUNNING delivered long ago with no PTY output is Stuck/Needs you, not Working",
);
assert.equal(
  deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({
      state: ORCH_STATE.RUNNING,
      deliveredAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    }),
  ).label,
  "Needs you",
);

assert.equal(
  deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, snap({ startedAt: new Date(Date.now() - 10_000) }))
    .phase,
  FEEDBACK_WORK_PHASE.QUEUED,
  "young undelivered run is queued",
);
assert.equal(
  deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({ startedAt: new Date(Date.now() - 5 * 60_000) }),
  ).phase,
  FEEDBACK_WORK_PHASE.STUCK,
  "undelivered past the starting window is stuck",
);
assert.equal(
  deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({ startedAt: new Date(Date.now() - 5 * 60_000), deliveredAt: new Date().toISOString() }),
  ).phase,
  FEEDBACK_WORK_PHASE.QUEUED,
  "delivered within the thinking window with no PTY output is Starting, not Working",
);
assert.equal(
  deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({
      startedAt: new Date(Date.now() - 20 * 60_000),
      deliveredAt: new Date(Date.now() - 19 * 60_000).toISOString(),
    }),
  ).phase,
  FEEDBACK_WORK_PHASE.STUCK,
  "delivered, then silent past the thinking window (measured from delivery) is stuck",
);

// Closed states — SUCCESS is not Done (inject/run finish ≠ live UI changed).
const successClosed = deriveFeedbackWork(
  FEEDBACK_STATUS.DISPATCHED,
  snap({
    state: ORCH_STATE.CLOSED,
    outcome: ORCHESTRATION_OUTCOME.SUCCESS,
    finishedAt: new Date(),
  }),
);
assert.equal(
  successClosed.phase,
  FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
  "SUCCESS close waits for live proof / operator Resolve — never Done alone",
);
assert.equal(successClosed.label, "Finished", "no ledger yet: Finished, not Check live");
assert.equal(
  successClosed.stepSummary,
  null,
  "a closed run must not keep saying the agent is working from its last event",
);
assert.ok(
  !successClosed.label.toLowerCase().includes("done"),
  "badge must not say Done before Resolve",
);
assert.equal(
  deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({
      state: ORCH_STATE.CLOSED,
      outcome: ORCHESTRATION_OUTCOME.PARTIAL,
      finishedAt: new Date(),
    }),
  ).phase,
  FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
  "PARTIAL close also needs verify, not Done",
);
// Only operator Resolve (DB resolved) is Done.
assert.equal(
  deriveFeedbackWork(FEEDBACK_STATUS.RESOLVED, null).label,
  "Done",
  "Resolve is the ship stamp that earns Done",
);
assert.equal(
  deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({
      state: ORCH_STATE.CLOSED,
      outcome: ORCHESTRATION_OUTCOME.ERROR,
      finishedAt: new Date(),
    }),
  ).phase,
  FEEDBACK_WORK_PHASE.FAILED,
);
assert.equal(
  deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, snap({ outcome: ORCHESTRATION_OUTCOME.HANG }))
    .phase,
  FEEDBACK_WORK_PHASE.FAILED,
);

// Never the word the layer exists to kill.
for (const status of [
  FEEDBACK_STATUS.NEW,
  FEEDBACK_STATUS.DISPATCHED,
  FEEDBACK_STATUS.RESOLVED,
] as const) {
  assert.ok(
    !deriveFeedbackWork(status, null).label.toLowerCase().includes("dispatched"),
    "labels never say 'dispatched'",
  );
}

// A detail line must EARN its row: it exists only to say what the badge cannot.
// "No agent has been asked to fix this yet." said nothing the "Not started"
// badge and the "Implement" button had not already said, and the fleet strip
// printed it once per row — five identical sentences on five new items.
assert.equal(
  deriveFeedbackWork(FEEDBACK_STATUS.NEW, null).detail,
  null,
  "Not started carries no detail — the badge and the Implement button already say it",
);

// Not generalised on purpose. "Adds information" is a judgement about meaning,
// and every mechanical proxy tried here (must contain an imperative; must not
// prefix-match the label) either missed the sentence above or failed honest
// copy like "Starting — waiting for the agent to pick it up." So this stays a
// single pin plus a reviewer's eye, rather than a green check that proves
// nothing.

// A raw run error is a diagnostic, not advice. /control printed one verbatim,
// twice: "Corrected 2026-08-24: repo evidence in the run window belonged to a
// sibling run; this run was acked verified:false and never started." The
// detail line is written for a human; the executor's text goes behind a
// disclosure the reader opens on purpose.
{
  const note = "Corrected 2026-08-24: repo evidence in the run window belonged to a sibling run";
  const failed = deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({ state: ORCH_STATE.ERROR, error: note }),
  );
  assert.equal(failed.phase, FEEDBACK_WORK_PHASE.FAILED);
  assert.equal(
    failed.diagnostic,
    note,
    "the error is kept — it is the most useful text when a run really did fail",
  );
  assert.ok(
    failed.detail && !failed.detail.includes("Corrected"),
    "...but the line addressed to the reader is written for the reader",
  );
  assert.ok(failed.detail!.includes("Retry"), "and it still says what to do next");
}

// Check live page href + Implement acceptance gate.
assert.equal(
  livePageHref(null, "https://example.com/pricing", "/pricing"),
  "https://example.com/pricing",
);
assert.equal(livePageHref(null, null, "/pricing"), null, "relative page alone is not enough");
assert.equal(
  livePageHref(null, null, "https://kivvi.app/door"),
  "https://kivvi.app/door",
  "absolute page works when url is empty",
);
assert.equal(feedbackInjectAccepted(200, { runId: "run-1" }), true);
assert.equal(feedbackInjectAccepted(200, { runId: "run-1", blocked: true }), false);
assert.equal(feedbackInjectAccepted(200, {}), false);
assert.equal(feedbackInjectAccepted(500, { runId: "run-1" }), false);

// A renamed project and a same-named sibling must never redirect Implement.
const projects = [
  { name: "old-name", entityProjectId: "other" },
  { name: "renamed", entityProjectId: "target" },
];
assert.equal(findInjectProject(projects, "old-name", "target")?.name, "renamed");
assert.equal(findInjectProject(projects, "old-name", "missing"), undefined);
assert.equal(findInjectProject(projects, "RENAMED")?.entityProjectId, "target");
const report = {
  suggestion: "Change heading",
  duplicateCount: 1,
  url: "https://example.com",
  page: null,
  scope: null,
  selectedElements: null,
};
for (const prompt of [
  composeFeedbackFixPrompt(report, "Site"),
  composeFeedbackBatchFixPrompt([report, report], "Site"),
]) {
  assert.match(prompt, /normal PR\/merge\/deploy path/);
  assert.match(prompt, /Leave feedback resolution to the operator/);
}

console.log("✓ feedback work-phase tests passed");

// 3. The runner heartbeat decides Working vs Stalled after delivery — not the
//    clock. Before this, every delivered run turned "Not running" at minute
//    ten while the agent typed, because nothing between "submitted" and
//    "closed" was ever written down (2026-09-11).
{
  const now = Date.now();
  const delivered = new Date(now - 47 * 60_000).toISOString();
  const long = deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({
      startedAt: new Date(now - 48 * 60_000),
      deliveredAt: delivered,
      lastProgressAt: new Date(now - 30_000).toISOString(),
      injectVerified: true,
      latestEventKind: "progress",
    }),
    now,
  );
  assert.equal(
    long.phase,
    FEEDBACK_WORK_PHASE.WORKING,
    "fresh heartbeat = Working, however long ago delivery was",
  );
  assert.equal(long.label, "Working · 47 min", "the badge says how long the agent has been on it");
  assert.equal(long.watchable, true, "a delivered run has a terminal to watch");
  assert.equal(long.since, delivered);

  const stalled = deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({
      startedAt: new Date(now - 48 * 60_000),
      deliveredAt: delivered,
      lastProgressAt: new Date(now - 15 * 60_000).toISOString(),
      injectVerified: true,
      latestEventKind: "progress",
    }),
    now,
  );
  assert.equal(stalled.phase, FEEDBACK_WORK_PHASE.STUCK, "a heartbeat gone quiet = Needs you");
  assert.equal(stalled.label, "Needs you");
  assert.equal(
    stalled.watchable,
    true,
    "Needs you still links the terminal — it may be waiting on a person",
  );
  assert.match(stalled.detail ?? "", /Open Terminal|Retry/);
  assert.match(stalled.diagnostic ?? "", /Worked 32 min, silent 15 min/);

  // Delivered and no heartbeat yet: Starting (Queued), never fake Working.
  const fresh = deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({
      startedAt: new Date(now - 3 * 60_000),
      deliveredAt: new Date(now - 2 * 60_000).toISOString(),
    }),
    now,
  );
  assert.equal(fresh.phase, FEEDBACK_WORK_PHASE.QUEUED);
  assert.equal(fresh.label, "Starting");
  const silent = deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({
      startedAt: new Date(now - 20 * 60_000),
      deliveredAt: new Date(now - 19 * 60_000).toISOString(),
    }),
    now,
  );
  assert.equal(silent.phase, FEEDBACK_WORK_PHASE.STUCK);
  assert.equal(silent.label, "Needs you");
  assert.equal(silent.watchable, true);

  // Queued (never delivered) has no PTY yet, but Watch still opens — step
  // summary + dig-in, Terminal only once terminalReady.
  const queued = deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({ startedAt: new Date(now - 10_000) }),
    now,
  );
  assert.equal(queued.phase, FEEDBACK_WORK_PHASE.QUEUED);
  assert.equal(queued.watchable, true);
  assert.equal(queued.terminalReady, false);

  // The elapsed label ladder.
  assert.equal(workElapsedLabel(new Date(now - 20_000), now), "under a minute");
  assert.equal(workElapsedLabel(new Date(now - 125 * 60_000), now), "2 h 05 min");
  assert.equal(workElapsedLabel(new Date(now - 120 * 60_000), now), "2 h");
}

// 4. "Waiting for a sign-in" outranks every other reading of silence, because
//    it is the only one the operator can act on — and acting takes ten seconds.
//    Before this the row said "no output" for thirteen minutes (2026-09-12).
{
  const now = Date.now();
  const base = {
    startedAt: new Date(now - 14 * 60_000),
    deliveredAt: new Date(now - 13 * 60_000).toISOString(),
  };
  const blocked = deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({ ...base, blocked: "auth" }),
    now,
  );
  assert.equal(blocked.label, "Needs you to sign in");
  assert.equal(blocked.watchable, true, "the terminal is where they sign in");
  assert.equal(blocked.detail, "Sign in on Watch");

  // Same run, no reason known: Needs you (not Working).
  const unexplained = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, snap(base), now);
  assert.equal(unexplained.label, "Needs you");

  // And a blocked flag never overrides an agent that is actually producing.
  const working = deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({
      ...base,
      blocked: null,
      lastProgressAt: new Date(now - 20_000).toISOString(),
      injectVerified: true,
      latestEventKind: "progress",
    }),
    now,
  );
  assert.equal(working.phase, FEEDBACK_WORK_PHASE.WORKING);
}

// 5. One alive bit — Working only with post-prompt evidence; inject-no-generate → Needs you.
{
  const now = Date.now();
  const base = {
    startedAt: new Date(now - 5 * 60_000),
    deliveredAt: new Date(now - 4 * 60_000).toISOString(),
    lastProgressAt: new Date(now - 20_000).toISOString(),
  };
  const bootOnly = deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({ ...base, latestEventKind: "submitted" }),
    now,
  );
  assert.notEqual(
    bootOnly.phase,
    FEEDBACK_WORK_PHASE.WORKING,
    "fresh lastProgress without generating/progress hop is not Working",
  );
  assert.equal(bootOnly.label, "Starting");

  const injectDead = deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({
      ...base,
      injectVerified: false,
      injectWarning: "agent isn't generating",
      latestEventKind: "blocked",
    }),
    now,
  );
  assert.equal(injectDead.phase, FEEDBACK_WORK_PHASE.STUCK);
  assert.equal(injectDead.label, "Needs you");
  assert.match(injectDead.detail ?? "", /Open Terminal|switch provider|Fleet Runner/);
  assert.match(injectDead.diagnostic ?? "", /generating|isn't generating/i);

  const alive = deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({ ...base, injectVerified: true, latestEventKind: "generating" }),
    now,
  );
  assert.equal(alive.phase, FEEDBACK_WORK_PHASE.WORKING);

  const progressHop = deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({ ...base, latestEventKind: "progress" }),
    now,
  );
  assert.equal(progressHop.phase, FEEDBACK_WORK_PHASE.WORKING);

  const prePromptBytes = deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({
      ...base,
      deliveredAt: new Date(now - 10_000).toISOString(),
      lastProgressAt: new Date(now - 60_000).toISOString(),
      latestEventKind: "progress",
    }),
    now,
  );
  assert.notEqual(
    prePromptBytes.phase,
    FEEDBACK_WORK_PHASE.WORKING,
    "progress before deliveredAt is boot redraw, not Working",
  );
  const verifiedOnly = deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    snap({
      startedAt: new Date(now - 2 * 60_000),
      deliveredAt: new Date(now - 90_000).toISOString(),
      injectVerified: true,
    }),
    now,
  );
  assert.equal(
    verifiedOnly.phase,
    FEEDBACK_WORK_PHASE.WORKING,
    "verified:true alone (no progress beat yet) is Working — post-prompt evidence",
  );
}
