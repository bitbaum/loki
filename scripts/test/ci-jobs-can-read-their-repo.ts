/**
 * A CI job that checks out its repo must be allowed to read it.
 *
 * A job-level `permissions:` block switches OFF everything it does not list.
 * The site template's `ship` job listed only `actions: write`; on a public
 * repo checkout still works, on a PRIVATE one it answers "Repository not
 * found". CI went red on main, the fleet sweep never ships a red main, and a
 * brand-new private site stopped one step before going live — with nobody told
 * (probe-loop, 2026-09-26). Loki provisions repos private by default, so every
 * new site would have hit it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = [
  "scripts/site-template/.github/workflows/ci.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/selfhost-deploy.yml",
];

let checked = 0;
for (const file of FILES) {
  const src = readFileSync(file, "utf8");
  const jobsAt = src.search(/^jobs:\s*$/m);
  assert.ok(jobsAt >= 0, `${file}: no jobs block`);
  // Split into jobs at two-space-indented keys under `jobs:`.
  const body = src.slice(jobsAt);
  const heads = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)];
  heads.forEach((h, i) => {
    const job = body.slice(h.index, heads[i + 1]?.index ?? body.length);
    const perms = job.match(/^ {4}permissions:\s*\n((?: {6}.*\n)+)/m);
    if (!perms || !/uses: actions\/checkout@/.test(job)) return;
    checked++;
    assert.match(
      perms[1]!,
      /contents:\s*(read|write)/,
      `${file} job "${h[1]}" checks out code but its permissions do not grant contents — on a private repo that is "Repository not found"`,
    );
  });
}
assert.ok(checked >= 2, `expected to check the ship jobs, checked ${checked}`);
console.log(
  `ci-jobs-can-read-their-repo: ${checked} job(s) with a permissions block can read their repo`,
);
