/**
 * The deploy rolls a change back when it made the live page worse on a phone.
 * These pin what "worse" means — only things this change ADDED, never a
 * problem the page already had — and that no baseline is never a regression.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { comparePageChecks } from "../hetzner/page-check-compare.mjs";

const good = {
  ok: true,
  status: 200,
  overflowX: false,
  errors: 0,
  brokenImages: 0,
  textLength: 1000,
  headings: 8,
};
const worse = (patch: Partial<typeof good>) => comparePageChecks(good, { ...good, ...patch });

assert.deepEqual(comparePageChecks(good, good).regressions, [], "unchanged is fine");
assert.deepEqual(worse({ textLength: 1200, headings: 9 }).regressions, [], "more content is fine");

assert.match(worse({ ok: false, status: 500 }).regressions[0]!, /no longer loads \(HTTP 500\)/);
assert.match(worse({ overflowX: true }).regressions[0]!, /scrolls sideways/);
assert.match(worse({ errors: 2 }).regressions[0]!, /new script errors in the browser \(0 → 2\)/);
assert.match(worse({ brokenImages: 1 }).regressions[0]!, /images broke/);
assert.match(worse({ textLength: 400 }).regressions[0]!, /text disappeared/);
assert.match(worse({ headings: 0 }).regressions.join(" "), /every heading disappeared/);
assert.deepEqual(worse({ textLength: 600 }).regressions, [], "a 40% edit is an edit, not a wipe");

// Only what the change added: a page that already had the problem is not worse.
const already = { ...good, overflowX: true, errors: 3, brokenImages: 1 };
assert.deepEqual(comparePageChecks(already, already).regressions, []);
assert.deepEqual(
  comparePageChecks(already, { ...already, errors: 2 }).regressions,
  [],
  "fewer errors",
);

// No baseline — first deploy, or the old page was down — is reported, not failed.
for (const before of [null, { ...good, ok: false, status: 502 }]) {
  const v = comparePageChecks(before, { ...good, overflowX: true });
  assert.deepEqual(v.regressions, [], "nothing to compare is never a rollback");
  assert.ok(v.notes.some((n) => /no earlier version/.test(n)));
  assert.ok(
    v.notes.some((n) => /scrolls sideways/.test(n)),
    "still says what it saw",
  );
}

// The shared deploy looks before AND after, and rolls back only on "worse".
const wf = readFileSync(".github/workflows/selfhost-deploy.yml", "utf8");
const before = wf.indexOf("Look at the live page before the deploy");
const deploy = wf.indexOf("- name: Deploy\n");
const after = wf.indexOf("Compare the live page with before");
assert.ok(
  before > 0 && before < deploy && deploy < after,
  "before → deploy → after, in that order",
);
assert.match(wf, /if \[ "\$rc" -eq 2 \]; then[\s\S]*rollback\.sh/, "worse → roll back");

console.log("page-check-compare: ok");
