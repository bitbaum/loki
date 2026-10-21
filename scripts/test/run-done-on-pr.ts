// A run whose agent opened its PR and went quiet closes Done with that PR
// (Substrata c7d57dc0, 2026-10-22: #190 open, run still "Working" 20+ min).
import assert from "node:assert/strict";
import { shippedPr } from "../../src/lib/salvage-plan";
import { SHIPPED_PR_URL_RE, shouldCheckShipped, SHIPPED_IDLE_MS } from "../../src/lib/run-progress";

const url = "https://github.com/bitbaum/substrata/pull/190";
const ok = {
  dirty: false,
  branch: "loki/run-c7d57dc0",
  defaultBranch: "main",
  headSha: "cee92ed",
  pr: { url, state: "OPEN", headRefOid: "cee92ed" },
};
assert.equal(shippedPr(ok), url);
assert.equal(shippedPr({ ...ok, dirty: true }), null, "uncommitted work: not done");
assert.equal(shippedPr({ ...ok, headSha: "abc1234" }), null, "unpushed commits: not done");
assert.equal(shippedPr({ ...ok, pr: { ...ok.pr, state: "MERGED" } }), null);
assert.equal(shippedPr({ ...ok, pr: null }), null);
assert.equal(shippedPr({ ...ok, branch: "main" }), null);
assert.equal(shippedPr({ ...ok, pr: { ...ok.pr, url: "https://evil.example/pull/1" } }), null);
assert.ok(SHIPPED_PR_URL_RE.test(url));
assert.ok(!SHIPPED_PR_URL_RE.test(url + "\nx"));

const now = 10_000_000;
assert.equal(
  shouldCheckShipped({ lastOutputAt: now - 10_000, shipCheckedAt: 0 }, now),
  false,
  "still printing",
);
assert.equal(
  shouldCheckShipped({ lastOutputAt: now - SHIPPED_IDLE_MS, shipCheckedAt: 0 }, now),
  true,
);
assert.equal(
  shouldCheckShipped({ lastOutputAt: 0, shipCheckedAt: now - 5_000 }, now),
  false,
  "rate-limited",
);
console.log("run-done-on-pr: ok");
