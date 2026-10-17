// What the repository says a build has pushed (src/lib/repo-progress.ts):
// commit messages read as sentences, check runs read as one verdict.
import assert from "node:assert/strict";

import { commitHeadline, summarizeChecks } from "../../src/lib/repo-progress";

assert.equal(
  commitHeadline("fix(header): keep the menu above the tour\n\nbody"),
  "Keep the menu above the tour",
);
assert.equal(commitHeadline("feat!: drop the old card"), "Drop the old card");
assert.equal(commitHeadline("Plain message"), "Plain message");
assert.ok(commitHeadline("x".repeat(300)).length <= 140);

assert.equal(summarizeChecks([]), null, "nothing reported is not a verdict");
assert.equal(summarizeChecks([{ status: "in_progress", conclusion: null }]), "running");
assert.equal(
  summarizeChecks([
    { status: "completed", conclusion: "success" },
    { status: "completed", conclusion: "failure" },
  ]),
  "failed",
  "one red check is a failed verdict",
);
assert.equal(
  summarizeChecks([
    { status: "completed", conclusion: "success" },
    { status: "completed", conclusion: "skipped" },
  ]),
  "passed",
);
assert.equal(
  summarizeChecks([
    { status: "completed", conclusion: "success" },
    { status: "queued", conclusion: null },
  ]),
  "running",
  "a queued check keeps the verdict open",
);

console.log("✓ repo-progress: headlines and check verdicts");
