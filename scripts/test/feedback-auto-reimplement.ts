// A feedback run refused at its last step gets one automatic second attempt —
// and only the failures a second attempt can answer.
import assert from "node:assert/strict";
import {
  decideAutoReimplement,
  autoRetryNotice,
} from "../../src/lib/feedback/auto-reimplement-policy";
import { deriveFeedbackWork, FEEDBACK_WORK_PHASE } from "../../src/lib/feedback/work-phase";
import { FEEDBACK_STATUS } from "../../src/lib/constants/statuses";
import { ORCH_STATE } from "../../src/lib/orchestration/contract";

const CAPACITY =
  "Dispatch failed before the prompt reached the agent: claude cannot generate because its usage limit is exhausted. Switch this project to a provider with available capacity, then Retry.";
const NO_GEN =
  "launched claude (pty) + injected, but Loki could not verify generation. claude opened on this computer, but produced no response after Loki submitted the prompt.";
const AUTH =
  "claude is not authenticated (401 / login required) — the prompt was delivered but the agent can't run.";
const WORKSPACE =
  'workspace for "petvity" is not materializable on this builder: /home/g/dev/petvity does not exist here and the project has no cloneable GitHub gitUrl.';

assert.deepEqual(decideAutoReimplement(CAPACITY, null), {
  retry: true,
  because: "the agent hit its usage limit",
});
assert.deepEqual(decideAutoReimplement(NO_GEN, {}), {
  retry: true,
  because: "the agent opened but never started generating",
});
assert.equal(decideAutoReimplement(AUTH, null).retry, false, "dead credentials need a person");
assert.equal((decideAutoReimplement(AUTH, null) as { reason: string }).reason, "needs-auth");
assert.equal(
  (decideAutoReimplement(WORKSPACE, null) as { reason: string }).reason,
  "needs-workspace",
);
assert.equal(
  (decideAutoReimplement("runner error", null) as { reason: string }).reason,
  "not-retryable",
);
assert.equal((decideAutoReimplement("", null) as { reason: string }).reason, "no-error");
assert.equal(
  (decideAutoReimplement(CAPACITY, { priorRunId: "abc" }) as { reason: string }).reason,
  "already-retried",
  "a retry is never retried",
);
assert.equal(
  (
    decideAutoReimplement(CAPACITY, { feedbackAutoRetriedAt: "2026-09-28T06:35:00Z" }) as {
      reason: string;
    }
  ).reason,
  "already-retried",
);

// The row says Loki acted, while the second run moves.
{
  const now = Date.parse("2026-09-28T06:40:00Z");
  const view = deriveFeedbackWork(
    FEEDBACK_STATUS.DISPATCHED,
    {
      id: "r2",
      state: ORCH_STATE.WAITING,
      outcome: null,
      startedAt: new Date(now - 10_000),
      finishedAt: null,
      deliveredAt: null,
      lastProgressAt: null,
      blocked: null,
      injectVerified: null,
      injectWarning: null,
      error: null,
      summaryDone: null,
      autoRetriedBecause: "the agent hit its usage limit",
      pendingUnclaimed: true,
      cloudOnline: true,
      localOnline: false,
      builderChannel: "cloud",
    },
    now,
  );
  assert.equal(view.phase, FEEDBACK_WORK_PHASE.QUEUED);
  assert.equal(view.detail, autoRetryNotice("the agent hit its usage limit"));
  assert.match(view.detail!, /^Retried automatically/);
}

console.log("feedback-auto-reimplement: ok");
