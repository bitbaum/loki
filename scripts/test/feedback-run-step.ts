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
assert.equal(offline.label, "Needs you");
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

// ── Waiting its turn is not a broken builder ───────────────────────────────
// Loki runs one agent per project: while a run is open, the queue withholds
// the next command for that project. On 2026-09-17 a dispatch held that way
// was reported as "Retry — or Open Terminal for why it never started" on the
// row, while the panel beneath it said "confirm Fleet Runner is polling" —
// both wrong, contradicting each other, about a queue and a runner that were
// working exactly as designed.
const queuedBehind = summarizeRunStep({
  latestKind: "dispatched",
  deliveredAt: null,
  lastProgressAt: null,
  pendingUnclaimed: true,
  channel: "local",
  localOnline: true,
  queuedBehind: { label: "Next Best Task" },
});
assert.equal(queuedBehind.kind, "waiting_builder");
assert.match(queuedBehind.summary, /Next Best Task/);
assert.doesNotMatch(
  `${queuedBehind.summary} ${queuedBehind.detail ?? ""}`,
  /Fleet Runner is polling|confirm .* is polling|restart/i,
  "must not send the reader to inspect a builder that is doing nothing wrong",
);
// Naming Retry to say it would NOT help is the point; offering it as the
// remedy is the bug. The copy has to say the wait ends by itself.
assert.match(queuedBehind.detail ?? "", /starts by itself|when the run ahead/i);

// A blocker with no recorded label still says the true thing.
const queuedUnnamed = summarizeRunStep({
  latestKind: "dispatched",
  deliveredAt: null,
  lastProgressAt: null,
  pendingUnclaimed: true,
  channel: "local",
  localOnline: true,
  queuedBehind: { label: null },
});
assert.match(queuedUnnamed.summary, /turn/i);

// Without a blocker the builder copy is unchanged — the fix must not swallow
// the real "nobody is claiming this" case.
assert.match(
  summarizeRunStep({
    latestKind: "dispatched",
    deliveredAt: null,
    lastProgressAt: null,
    pendingUnclaimed: true,
    channel: "local",
    localOnline: true,
  }).detail ?? "",
  /Fleet Runner is polling/,
);

// ── The row agrees with the panel ──────────────────────────────────────────
const heldRun = {
  id: "run-held",
  state: ORCH_STATE.WAITING,
  outcome: null,
  startedAt: new Date(Date.now() - 20 * 60_000), // far past the "never started" age
  finishedAt: null,
  deliveredAt: null,
  lastProgressAt: null,
  error: null,
  pendingUnclaimed: true,
  builderChannel: "local" as const,
  localOnline: true,
  cloudOnline: true,
  queuedBehind: {
    runId: "run-ahead",
    label: "Next Best Task",
    startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  },
};
const heldView = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, heldRun);
assert.equal(
  heldView.phase,
  FEEDBACK_WORK_PHASE.QUEUED,
  "queued behind a run is QUEUED, not STUCK",
);
assert.match(heldView.detail ?? "", /Next Best Task/);
assert.doesNotMatch(heldView.detail ?? "", /never started/i);

// The same run with nothing ahead of it keeps the honest stuck reading.
const orphanView = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, {
  ...heldRun,
  queuedBehind: null,
});
assert.equal(orphanView.phase, FEEDBACK_WORK_PHASE.STUCK);
assert.match(orphanView.detail ?? "", /never started/i);

console.log("  ✓ a dispatch waiting its turn is named, not blamed");
