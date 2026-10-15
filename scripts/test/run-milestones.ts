// What a running build has done so far (src/lib/run-milestones.ts): repo facts
// told in order, in the builder's own words, never invented.
import assert from "node:assert/strict";

import { buildRunMilestones, commitHeadline, summarizeChecks } from "../../src/lib/run-milestones";

// ---- nothing yet: just picked up, or not even that ----
assert.deepEqual(buildRunMilestones({ startedAt: null, repo: null }), []);
{
  const m = buildRunMilestones({ startedAt: "2026-10-15T10:00:00Z", repo: null });
  assert.equal(m.length, 1);
  assert.equal(m[0].key, "picked_up");
}

// ---- commit messages read as sentences ----
assert.equal(
  commitHeadline("fix(header): keep the menu above the tour\n\nbody"),
  "Keep the menu above the tour",
);
assert.equal(commitHeadline("feat!: drop the old card"), "Drop the old card");
assert.equal(commitHeadline("Plain message"), "Plain message");
assert.ok(commitHeadline("x".repeat(300)).length <= 140);

// ---- the whole story, in time order ----
{
  const m = buildRunMilestones({
    startedAt: "2026-10-15T10:00:00Z",
    repo: {
      commits: [
        { sha: "a", message: "fix: one", at: "2026-10-15T10:05:00Z", url: "u/a" },
        { sha: "b", message: "fix: two", at: "2026-10-15T10:09:00Z", url: "u/b" },
      ],
      pr: {
        number: 12,
        title: "Keep the menu above the tour",
        url: "https://github.com/o/r/pull/12",
        at: "2026-10-15T10:07:00Z",
        checks: "running",
      },
    },
  });
  assert.deepEqual(
    m.map((x) => x.key),
    ["picked_up", "commit", "pr", "commit", "checks"],
  );
  assert.equal(m[2].label, "Opened pull request #12");
  assert.equal(m[2].quote, "Keep the menu above the tour");
  const same = buildRunMilestones({
    startedAt: null,
    repo: {
      commits: [{ sha: "a", message: "feat(x): one thing", at: "2026-10-15T10:05:00Z", url: "u" }],
      pr: {
        number: 1,
        title: "feat(x): one thing",
        url: "p",
        at: "2026-10-15T10:06:00Z",
        checks: null,
      },
    },
  });
  assert.equal(same[1].quote, null, "the PR does not repeat its only commit");
  assert.equal(m[4].label, "Checks are running");
  assert.equal(m[4].href, "https://github.com/o/r/pull/12/checks");
  assert.equal(m[1].quote, "One");
}

// ---- many commits collapse to the newest three, and say so ----
{
  const commits = Array.from({ length: 7 }, (_, i) => ({
    sha: String(i),
    message: `fix: step ${i}`,
    at: `2026-10-15T10:0${i}:00Z`,
    url: `u/${i}`,
  }));
  const m = buildRunMilestones({ startedAt: null, repo: { commits, pr: null } });
  assert.equal(m.length, 3);
  assert.equal(m[0].label, "Pushed 5 commits, the latest:");
  assert.equal(m[2].quote, "Step 6");
}

// ---- checks ----
assert.equal(summarizeChecks([]), null);
assert.equal(summarizeChecks([{ status: "completed", conclusion: "success" }]), "passed");
assert.equal(
  summarizeChecks([
    { status: "completed", conclusion: "success" },
    { status: "in_progress", conclusion: null },
  ]),
  "running",
);
assert.equal(
  summarizeChecks([
    { status: "in_progress", conclusion: null },
    { status: "completed", conclusion: "failure" },
  ]),
  "failed",
  "a failure is news even while others still run",
);
assert.equal(
  summarizeChecks([
    { status: "completed", conclusion: "skipped" },
    { status: "completed", conclusion: "success" },
  ]),
  "passed",
);

// ---- the list stays after the run, and ends by saying how it ended ----
{
  const m = buildRunMilestones({
    startedAt: "2026-10-15T10:00:00Z",
    repo: null,
    finished: { at: "2026-10-15T10:20:00Z", outcome: "success" },
  });
  assert.deepEqual(
    m.map((x) => x.key),
    ["picked_up", "finished"],
  );
  assert.equal(m[1].label, "Finished — the builder reported back");
  const failed = buildRunMilestones({
    startedAt: null,
    repo: null,
    finished: { at: "2026-10-15T10:20:00Z", outcome: "timeout" },
  });
  assert.equal(failed[0].tone, "negative");
}

console.log("run-milestones: ok");
