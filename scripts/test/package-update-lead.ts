// A held package update leads with one plain sentence (config/package-updates).
// On 2026-11-12 the card opened on "@bitbaum/chatkit v0.21.2 → v0.23.0 breaking".
import assert from "node:assert/strict";
import { UPDATE_DECISION_LABELS, updateLeadSentence } from "../../src/config/package-updates";

assert.equal(
  updateLeadSentence({ projectName: "Keller", count: 3, breaking: 2 }),
  "Keller can move to newer versions of 3 shared parts. 2 of them may need changes to the project's code.",
);
assert.equal(
  updateLeadSentence({ projectName: "Keller", count: 1, breaking: 0 }),
  "Keller can move to a newer version of one shared part.",
);
assert.equal(
  updateLeadSentence({ projectName: "Keller", count: 1, breaking: 1 }),
  "Keller can move to a newer version of one shared part. It may need changes to the project's code.",
);
// The two answers that are not "Update" say how they differ.
assert.equal(UPDATE_DECISION_LABELS.later, "Ask me again in 7 days");
assert.notEqual(UPDATE_DECISION_LABELS.later, UPDATE_DECISION_LABELS.stay);
console.log("✓ package-update-lead");
