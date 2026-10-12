import assert from "node:assert/strict";
import { queuedActionView } from "../../src/lib/loki/queued-action-view";

const t = "Message Anna about Friday";
const base = { title: t, autoApproved: false };

// A draft offers the decision, under the answer.
const draft = queuedActionView({ ...base, status: "draft" });
assert.equal(draft.canDecide, true);
assert.equal(draft.tone, "pending");
assert.ok(draft.line.includes(t));

// Unknown status still offers it: the server is the judge of what is a draft.
assert.equal(queuedActionView({ ...base, status: null }).canDecide, true);

// Approved and carried out.
const done = queuedActionView({ ...base, status: "draft", result: { executed: true } });
assert.equal(done.canDecide, false);
assert.equal(done.tone, "positive");
assert.ok(done.line.startsWith("Done"));
assert.equal(
  queuedActionView({ ...base, status: "executed" }).line,
  done.line,
  "a reload reads the same",
);

// Approved, but no executor for this kind: say where it waits.
const deferred = queuedActionView({
  ...base,
  status: "draft",
  result: { executed: false, deferred: true },
});
assert.ok(/waits in Approvals/.test(deferred.line));
assert.equal(deferred.reviewLabel, "Open Approvals");
assert.equal(queuedActionView({ ...base, status: "approved" }).line, deferred.line);

// Approved, executor failed: the error, and the way to retry.
const failed = queuedActionView({
  ...base,
  status: "draft",
  result: { executed: false, error: "WhatsApp is not connected" },
});
assert.equal(failed.tone, "warning");
assert.ok(failed.line.includes("WhatsApp is not connected"));
assert.equal(failed.reviewLabel, "Retry from Approvals");

// Declined, now or before.
assert.ok(
  queuedActionView({ ...base, status: "draft", declined: true }).line.startsWith("Declined"),
);
assert.ok(queuedActionView({ ...base, status: "rejected" }).line.startsWith("Declined"));
assert.equal(queuedActionView({ ...base, status: "rejected" }).canDecide, false);

// Expired drafts are not offered for approval.
assert.equal(queuedActionView({ ...base, status: "expired" }).canDecide, false);

// A standing approval: already running, never offered again.
const auto = queuedActionView({ title: t, autoApproved: true, status: "draft" });
assert.equal(auto.canDecide, false);
assert.ok(auto.line.startsWith("Doing it now"));

console.log("✓ loki queued action view");
