// Pure unit test: run→wall moment builder + promote policy entry.
// No DB, no network — auto-discovered by scripts/test-unit.ts.
import assert from "node:assert";
import {
  buildRunMoment,
  type RunPromoteInput,
} from "../../src/lib/integrations/orangecat-run-moment";
import { PROMOTE_POLICY, isPromoted } from "../../src/config/orangecat-publish";

// Policy (decision of 2026-11-14, src/config/orangecat-publish.ts): a build
// log is not a post. Closed runs and dev-log entries stay in Loki; the one
// moment sent to OrangeCat's timeline is a project going public. Switching
// either back on puts "e2e ok — no changes" on a community feed again, so it
// has to be done here too, on purpose.
assert.equal(isPromoted("run_closed"), false, "a closed run is not a public post");
assert.equal(isPromoted("devlog_entry"), false, "a dev-log entry is not a public post");
assert.equal(isPromoted("project_published"), true, "a project going public is");
assert.deepEqual(
  Object.entries(PROMOTE_POLICY)
    .filter(([, p]) => p.enabled)
    .map(([k]) => k),
  ["project_published"],
  "a new moment is a decision: add it to the policy and to this list",
);
assert.equal(PROMOTE_POLICY.run_closed.eventType, "project_updated");

const run: RunPromoteInput = {
  id: "11111111-2222-3333-4444-555555555555",
  userId: "u1",
  projectKey: "orangecat",
  intent: "queue",
  adapter: "claude",
  summary: {
    done: "Shipped per-run cost accounting\nplus a slug fix",
    next: "wire the escalation ladder",
    commit: "f754eacf",
  },
  payload: { durationMs: 123_000 },
  tokensIn: 1100,
  tokensOut: 550,
  costUsd: 0.13,
};

const moment = buildRunMoment("OrangeCat", run);

// Deterministic external id = run id → OC reconciles instead of double-posting.
assert.equal(moment.externalId, "loki_run_11111111-2222-3333-4444-555555555555");
assert.equal(buildRunMoment("OrangeCat", run).externalId, moment.externalId);

// Title = project + first line of done; description carries done + next.
assert.equal(moment.title, "OrangeCat: Shipped per-run cost accounting");
assert.ok(moment.description?.includes("Next: wire the escalation ladder"));

// The cost-accounting figures ride along in content.
assert.equal(moment.content?.kind, "orchestration_run");
assert.equal(moment.content?.commit, "f754eacf");
assert.equal(moment.content?.tokensIn, 1100);
assert.equal(moment.content?.tokensOut, 550);
assert.equal(moment.content?.costUsd, 0.13);
assert.equal(moment.content?.durationMs, 123_000);

// Sparse run: no summary, no usage — falls back honestly, omits absent fields.
const sparse = buildRunMoment("Kivvi", {
  id: "x",
  userId: "u1",
  projectKey: "kivvi",
  intent: "nextbest",
  adapter: "claude",
  summary: { commit: "none" },
});
assert.equal(sparse.title, "Kivvi: agent run completed");
assert.equal(sparse.description, undefined);
assert.ok(!("commit" in (sparse.content ?? {})), "commit 'none' must not publish");
assert.ok(!("tokensIn" in (sparse.content ?? {})));
assert.ok(!("costUsd" in (sparse.content ?? {})));

console.log("oc-run-promote: all assertions passed");
