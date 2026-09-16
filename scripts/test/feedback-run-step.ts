import assert from "node:assert/strict";
import { summarizeRunStep, furthestRunEventKind } from "../../src/lib/feedback/run-step";
import {
  deriveFeedbackWork,
  FEEDBACK_WORK_PHASE,
  WAITING_ON,
} from "../../src/lib/feedback/work-phase";
import { FEEDBACK_STATUS } from "../../src/lib/constants/statuses";
import { ORCH_STATE } from "../../src/lib/orchestration/contract";

const waitingCloud = summarizeRunStep({
  latestKind: "dispatched",
  deliveredAt: null,
  lastProgressAt: null,
  pendingUnclaimed: true,
  channel: "cloud",
  localOnline: false,
  cloudOnline: false,
});
assert.equal(waitingCloud.kind, "waiting_builder");
assert.match(waitingCloud.summary, /cloud builder/i);

const waitingLocal = summarizeRunStep({
  latestKind: "dispatched",
  deliveredAt: null,
  lastProgressAt: null,
  pendingUnclaimed: true,
  channel: "local",
  localOnline: true,
});
assert.equal(waitingLocal.kind, "waiting_builder");
assert.match(waitingLocal.summary, /This computer/i);
assert.doesNotMatch(waitingLocal.summary, /cloud/i);

const cloudQueuedLocalOnline = summarizeRunStep({
  latestKind: "dispatched",
  deliveredAt: null,
  lastProgressAt: null,
  pendingUnclaimed: true,
  channel: "cloud",
  localOnline: true,
  cloudOnline: false,
});
assert.equal(cloudQueuedLocalOnline.kind, "waiting_builder");
assert.match(cloudQueuedLocalOnline.summary, /Switch to This computer/i);
assert.match(cloudQueuedLocalOnline.detail ?? "", /Runs on/i);

const localOffline = summarizeRunStep({
  latestKind: "dispatched",
  deliveredAt: null,
  lastProgressAt: null,
  pendingUnclaimed: true,
  channel: "local",
  localOnline: false,
});
assert.match(localOffline.summary, /Open Fleet Runner/i);

const hosted = summarizeRunStep({
  latestKind: "dispatched",
  deliveredAt: null,
  lastProgressAt: null,
  hosted: true,
  pendingUnclaimed: true,
});
assert.equal(hosted.kind, "hosted_queued");

assert.equal(furthestRunEventKind(["dispatched", "claimed", "launched"]), "launched");

const offline = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, {
  id: "r1",
  state: ORCH_STATE.WAITING,
  outcome: null,
  startedAt: new Date(),
  finishedAt: null,
  deliveredAt: null,
  lastProgressAt: null,
  error: null,
  builderOffline: true,
  builderChannel: "cloud",
});
assert.equal(offline.phase, FEEDBACK_WORK_PHASE.STUCK);
assert.equal(offline.waitingOn, WAITING_ON.YOU);
assert.equal(offline.label, "Builder offline");
assert.ok(offline.diagnostic?.toLowerCase().includes("offline"));
assert.equal(offline.watchable, true);

const localOfflineStuck = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, {
  id: "r1b",
  state: ORCH_STATE.WAITING,
  outcome: null,
  startedAt: new Date(),
  finishedAt: null,
  deliveredAt: null,
  lastProgressAt: null,
  error: null,
  builderOffline: true,
  builderChannel: "local",
  localOnline: false,
});
assert.equal(localOfflineStuck.phase, FEEDBACK_WORK_PHASE.STUCK);
assert.match(localOfflineStuck.detail ?? "", /Fleet Runner|This computer/i);

const youngOnline = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, {
  id: "r2",
  state: ORCH_STATE.WAITING,
  outcome: null,
  startedAt: new Date(),
  finishedAt: null,
  deliveredAt: null,
  lastProgressAt: null,
  error: null,
  builderOffline: false,
  pendingUnclaimed: true,
  builderChannel: "cloud",
  localOnline: true,
  cloudOnline: false,
});
assert.equal(youngOnline.phase, FEEDBACK_WORK_PHASE.QUEUED);
assert.equal(youngOnline.waitingOn, WAITING_ON.MACHINE);
assert.ok(youngOnline.stepSummary);
assert.match(youngOnline.stepSummary ?? "", /Switch to This computer/i);
assert.equal(youngOnline.watchable, true);

console.log("feedback-run-step: ok");
