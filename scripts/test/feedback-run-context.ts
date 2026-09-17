// The one answer to "which builder is this run waiting on, and is it up".
//
// Four surfaces ask it: the inbox row, Watch, Terminal's Loki rail, and
// Implement's duplicate-guard. They used to answer three different ways —
// Terminal kept a stale copy that fell back to "any builder will do", and
// Watch and the guard hydrated nothing, so neither could ever see an offline
// builder. The guard gates a RETRY, so the row said "Needs you — Retry" while
// Implement answered "Already on this". These pins exist so that cannot recur.
import assert from "node:assert/strict";
import { applyRunContext } from "../../src/lib/feedback/run-context";
import {
  deriveFeedbackWork,
  FEEDBACK_WORK_PHASE,
  type FeedbackRunSnapshot,
} from "../../src/lib/feedback/work-phase";
import { FEEDBACK_STATUS } from "../../src/lib/constants/statuses";
import { ORCH_STATE } from "../../src/lib/orchestration/contract";

const now = Date.now();

function snap(over: Partial<FeedbackRunSnapshot> = {}): FeedbackRunSnapshot {
  return {
    id: "run-1",
    state: ORCH_STATE.WAITING,
    outcome: null,
    startedAt: new Date(now - 5 * 60_000),
    finishedAt: null,
    deliveredAt: new Date(now - 4 * 60_000).toISOString(),
    lastProgressAt: null,
    error: null,
    ...over,
  };
}

const UP = { cloud: true, local: true, any: true };
const LOCAL_DOWN = { cloud: true, local: false, any: true };

// A local project whose Fleet Runner is off, with the cloud box up. The open
// pending row is long gone (the runner acks within ~8s of injecting), so the
// channel has to come from the project's stored routing decision.
{
  const s = applyRunContext(
    snap(),
    { payload: null },
    {
      presence: LOCAL_DOWN,
      project: { dirPath: "/home/g/dev/thing", gitUrl: null, builderPref: "local" },
      pending: null,
    },
  );
  assert.equal(s.builderChannel, "local", "no pending row → project's stored routing decides");
  assert.equal(
    s.builderOffline,
    true,
    "local builder down is OFFLINE even though the cloud box is up — the old !presence.any read this healthy",
  );

  const work = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, s, now);
  assert.equal(work.phase, FEEDBACK_WORK_PHASE.STUCK, "row must say Needs you");
  // This is the guard's own read: STUCK means Implement ALLOWS the retry.
  assert.notEqual(
    work.phase,
    FEEDBACK_WORK_PHASE.QUEUED,
    "QUEUED here is what made Implement refuse the retry",
  );
  assert.notEqual(
    work.phase,
    FEEDBACK_WORK_PHASE.WORKING,
    "WORKING here is what made Implement refuse the retry",
  );
}

// Same run, builders up: nothing about the above may turn an ordinary run stuck.
{
  const s = applyRunContext(
    snap(),
    { payload: null },
    {
      presence: UP,
      project: { dirPath: "/home/g/dev/thing", gitUrl: null, builderPref: "local" },
      pending: null,
    },
  );
  assert.equal(s.builderOffline, false, "builders up → not offline");
  const work = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, s, now);
  assert.notEqual(
    work.phase,
    FEEDBACK_WORK_PHASE.STUCK,
    "a healthy builder must not read as stuck",
  );
}

// An open pending row outranks the project default — it names the actual queue.
{
  const s = applyRunContext(
    snap(),
    { payload: null },
    {
      presence: { cloud: false, local: true, any: true },
      project: { dirPath: null, gitUrl: "https://github.com/x/y", builderPref: "local" },
      pending: {
        id: "cmd-1",
        type: "dispatch",
        claimedAt: null,
        executedAt: null,
        createdAt: new Date(),
        channel: "cloud",
      },
    },
  );
  assert.equal(s.builderChannel, "cloud", "the open row's channel wins over the project default");
  assert.equal(s.builderOffline, true, "cloud queue with the box down is offline");
  assert.equal(s.commandId, "cmd-1", "the open row supplies the command id");
}

// A hosted dispatch recorded on the payload must survive a non-hosted pending
// row — overwriting it was how hostedPending got erased mid-run.
{
  const s = applyRunContext(
    snap({ hostedPending: true }),
    { payload: { hostedDispatchId: "hosted-1" } },
    {
      presence: UP,
      pending: {
        id: "cmd-2",
        type: "dispatch",
        claimedAt: new Date(),
        executedAt: null,
        createdAt: new Date(),
        channel: "cloud",
      },
    },
  );
  assert.equal(s.hostedPending, true, "a non-hosted pending row must not erase a hosted dispatch");
}

console.log("✓ feedback run-context tests passed");
