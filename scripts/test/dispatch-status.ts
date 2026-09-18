/**
 * Inline tests for dispatch queue status copy.
 * Run: npx tsx scripts/test/dispatch-status.ts
 */
import {
  deriveDispatchLiveStatus,
  deriveMultiDispatchView,
  dispatchAssistantContent,
  dispatchStatusLabel,
  dispatchToneDotClass,
  elapsedLabel,
} from "@/lib/dispatch-status";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import { BUILDER_CHANNELS } from "@/lib/constants/statuses";

const offline = dispatchStatusLabel({
  mode: "queued",
  runnerConnected: false,
  warning: "runner-offline",
});
if (!offline.warn || offline.label !== EXECUTOR_COPY.queuedWhenOffline) {
  throw new Error("offline queued label");
}

const online = dispatchStatusLabel({ mode: "queued", runnerConnected: true });
if (online.warn || online.label !== EXECUTOR_COPY.queuedWithBuilderOnline) {
  throw new Error("online queued label");
}

const direct = dispatchStatusLabel({ mode: "direct" });
if (direct.warn || direct.label !== "Running now") {
  throw new Error("direct label");
}

const md = dispatchAssistantContent("loki", {
  ok: true,
  mode: "queued",
  runnerConnected: true,
});
if (!md.includes("loki") || !md.includes("builder")) {
  throw new Error("assistant content");
}

const delivered = deriveDispatchLiveStatus({
  claimedAt: new Date(),
  executedAt: new Date(),
  result: { ok: true, verified: true },
  run: { state: "waiting", outcome: null },
});
if (delivered.label !== "Delivered to agent" || delivered.terminal) {
  throw new Error("tracked delivery must keep polling");
}

const completed = deriveDispatchLiveStatus({
  claimedAt: new Date(),
  executedAt: new Date(),
  result: { ok: true, verified: true },
  run: { state: "done", outcome: "success" },
});
if (completed.label !== "Completed" || !completed.terminal || completed.tone !== "positive") {
  throw new Error("successful run completion");
}

const timeout = deriveDispatchLiveStatus({
  claimedAt: new Date(),
  executedAt: new Date(),
  result: { ok: true, verified: true },
  run: { state: "error", outcome: "timeout", payload: { error: "timed out" } },
});
if (timeout.label !== "Run timed out" || !timeout.terminal || timeout.tone !== "negative") {
  throw new Error("timed out run completion");
}

// ── Naming the builder ──────────────────────────────────────────────────────
//
// The operator should never have to wonder which machine has their work. Two
// rules, and the second matters more than the first: name it when we know, and
// NEVER name it when we don't — a label pointing at the wrong computer sends
// someone hunting through a checkout that never had the change.

const onLocal = dispatchStatusLabel({ mode: "direct", channel: "local" });
if (!onLocal.label.includes(EXECUTOR_COPY.ranOn.local) || onLocal.warn) {
  throw new Error("direct dispatch must name the local builder");
}

const onCloud = dispatchStatusLabel({ mode: "direct", channel: "cloud" });
if (!onCloud.label.includes(EXECUTOR_COPY.ranOn.cloud)) {
  throw new Error("direct dispatch must name the cloud builder");
}

// The highest-value case: nothing is happening, and this says which machine to
// wake rather than a generic "builder offline".
const offlineNamed = dispatchStatusLabel({
  mode: "queued",
  runnerConnected: false,
  warning: "runner-offline",
  channel: "local",
});
if (!offlineNamed.label.includes(EXECUTOR_COPY.ranOn.local) || !offlineNamed.warn) {
  throw new Error("offline queue must name the builder it is waiting on");
}

const queuedNamed = dispatchStatusLabel({
  mode: "queued",
  runnerConnected: true,
  channel: "cloud",
});
if (!queuedNamed.label.includes(EXECUTOR_COPY.ranOn.cloud) || queuedNamed.warn) {
  throw new Error("queued-with-builder must name the builder");
}

// Never guess. Messages persisted before routing was recorded carry no channel;
// they must fall back to the unnamed copy, not to a default machine.
for (const missing of [undefined, null]) {
  const bare = dispatchStatusLabel({ mode: "direct", channel: missing });
  if (bare.label !== "Running now") {
    throw new Error(`absent channel must not be named — got ${bare.label}`);
  }
  const bareQueued = dispatchStatusLabel({
    mode: "queued",
    runnerConnected: true,
    channel: missing,
  });
  if (bareQueued.label !== EXECUTOR_COPY.queuedWithBuilderOnline) {
    throw new Error(`absent channel must keep the unnamed queued copy — got ${bareQueued.label}`);
  }
}

// A failed dispatch names no machine: the failure, not the locus, is the point.
const failedNamed = dispatchStatusLabel({ ok: false, mode: "direct", channel: "cloud" });
if (failedNamed.label !== "Dispatch failed" || !failedNamed.warn) {
  throw new Error("failure copy must not be altered by the channel");
}

// The assistant transcript carries it too, so the chat log stays self-explaining.
const namedContent = dispatchAssistantContent("loki", {
  ok: true,
  mode: "queued",
  runnerConnected: true,
  channel: "cloud",
});
if (!namedContent.includes(EXECUTOR_COPY.ranOn.cloud)) {
  throw new Error("assistant content must name the builder");
}

// Every channel in the union has a name — no channel can render as "undefined".
for (const channel of BUILDER_CHANNELS) {
  const name = EXECUTOR_COPY.ranOn[channel];
  if (!name || typeof name !== "string") {
    throw new Error(`channel ${channel} has no operator-facing name`);
  }
  if (!dispatchStatusLabel({ mode: "direct", channel }).label.includes(name)) {
    throw new Error(`channel ${channel} is not surfaced in its label`);
  }
}

// ── Fan-out dispatch badge (2026-08-19) ─────────────────────────────────────
//
// Reported: a "develop these 3 projects" dispatch that started 0 of 3 showed
// the same generic green "Dispatched" chip as one that started 3 of 3 — the
// footer badge never read the real per-project attempts, only the reply text
// above it (formatMultiDispatchReply) was honest. deriveMultiDispatchView is
// the fix: the badge and the text now agree, because they read the same data.

const allStarted = deriveMultiDispatchView([
  { projectKey: "loki", ok: true },
  { projectKey: "orangecat", ok: true },
]);
if (allStarted.tone !== "positive" || allStarted.primaryProject !== "loki") {
  throw new Error(
    `all-started must be positive and link the first started project — got ${JSON.stringify(allStarted)}`,
  );
}

const noneStarted = deriveMultiDispatchView([
  { projectKey: "loki", ok: false, skipped: true, reason: "busy" },
  { projectKey: "orangecat", ok: false, skipped: true, reason: "pending_command" },
]);
if (noneStarted.tone !== "negative" || noneStarted.primaryProject !== null) {
  throw new Error(
    `0-of-N must be negative with no link to watch — got ${JSON.stringify(noneStarted)}`,
  );
}
if (!noneStarted.label.includes("0 of 2")) {
  throw new Error(`0-of-N label must say so plainly — got "${noneStarted.label}"`);
}

const partialStarted = deriveMultiDispatchView([
  { projectKey: "loki", ok: true },
  { projectKey: "orangecat", ok: false, skipped: true, reason: "busy" },
  { projectKey: "datacat", ok: false, skipped: true, reason: "concurrency_cap" },
]);
if (partialStarted.tone !== "warning" || partialStarted.primaryProject !== "loki") {
  throw new Error(
    `partial start must warn and link a project that actually started — got ${JSON.stringify(partialStarted)}`,
  );
}
if (!partialStarted.label.includes("1 of 3")) {
  throw new Error(
    `partial-start label must say how many of how many — got "${partialStarted.label}"`,
  );
}

// The link must never point at a SKIPPED project just because it happened to
// be first in the list — that was the second half of the reported bug.
const skippedFirst = deriveMultiDispatchView([
  { projectKey: "skipped-one", ok: false, skipped: true, reason: "busy" },
  { projectKey: "started-one", ok: true },
]);
if (skippedFirst.primaryProject !== "started-one") {
  throw new Error(
    `link must skip past a failed first attempt to the project that actually started — got ${skippedFirst.primaryProject}`,
  );
}

// Every tone in the union renders a real dot class — none can fall through to
// undefined and print "undefined" as a CSS class in the DOM.
for (const tone of ["positive", "warning", "negative", "neutral"] as const) {
  const cls = dispatchToneDotClass(tone);
  if (!cls || !cls.startsWith("ui-dot-")) {
    throw new Error(`tone ${tone} has no dot class — got "${cls}"`);
  }
}

// ── Elapsed time on the states that can go quiet ────────────────────────────
//
// Observed 2026-09-18: a dispatch sat on "waiting for a completion handoff" for
// five minutes with no elapsed time, no heartbeat and no log. A dead builder
// and a busy one read identically, and the only way to tell them apart was to
// open another window and read git log.

const T0 = Date.parse("2026-09-18T06:40:00.000Z");
const at = (secs: number) => T0 + secs * 1000;

{
  // The exact shape that went quiet: executed, run open, waiting on a handoff.
  const view = deriveDispatchLiveStatus(
    {
      claimedAt: new Date(T0).toISOString(),
      executedAt: new Date(T0).toISOString(),
      result: {},
      run: { state: "waiting", outcome: null },
    },
    at(305),
  );
  if (view.terminal) throw new Error("a run awaiting a handoff is not terminal");
  if (!view.detail?.includes("5m")) {
    throw new Error(`waiting detail must carry elapsed time — got "${view.detail}"`);
  }
  // The internal name for the mechanism is not what a person needs.
  if (view.detail?.includes("completion handoff")) {
    throw new Error("jargon leaked back into the waiting state");
  }
}

{
  // Picked up but not yet executed — timed from claimedAt, not executedAt.
  const view = deriveDispatchLiveStatus(
    { claimedAt: new Date(T0).toISOString(), executedAt: null, result: {}, run: null },
    at(90),
  );
  if (!view.detail?.includes("1m")) {
    throw new Error(`picked-up detail must carry elapsed time — got "${view.detail}"`);
  }
}

{
  // A settled run says what happened, not how long it has been happening.
  const view = deriveDispatchLiveStatus(
    {
      claimedAt: new Date(T0).toISOString(),
      executedAt: new Date(T0).toISOString(),
      result: {},
      run: { state: "done", outcome: "success" },
    },
    at(9999),
  );
  if (!view.terminal) throw new Error("a successful run is terminal");
  if (view.detail?.includes("·")) {
    throw new Error("a finished run must not keep counting");
  }
}

// The label itself, across the boundaries that matter.
const labels: [number, string | null][] = [
  [3, "just now"],
  [42, "42s"],
  [60, "1m"],
  [305, "5m"],
  [3600, "1h"],
  [4500, "1h 15m"],
];
for (const [secs, expected] of labels) {
  const got = elapsedLabel(new Date(T0).toISOString(), at(secs));
  if (got !== expected) throw new Error(`elapsed ${secs}s → expected ${expected}, got ${got}`);
}
// No timestamp is "no idea", never "0s" — a confident zero is worse than silence.
if (elapsedLabel(null) !== null) throw new Error("a missing timestamp has no elapsed label");
// A clock that disagrees must not render a negative age.
if (elapsedLabel(new Date(T0).toISOString(), at(-30)) !== null) {
  throw new Error("a future timestamp has no elapsed label");
}

console.log("✓ dispatch-status tests passed");
