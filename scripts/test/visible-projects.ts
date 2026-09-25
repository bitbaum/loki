import assert from "node:assert/strict";
import { mergeVisibleProjects } from "../../src/lib/visible-projects";

/**
 * Own + org projects, each once. getOrgProjects() includes the caller, so the
 * naive spread doubled every own project (actor-status, fleet/status).
 *
 * Run: npx tsx scripts/test/visible-projects.ts
 */
console.log("visible projects:");

const own = [
  { id: "a", name: "orangecat", mine: true },
  { id: "b", name: "loki", mine: true },
];
const org = [
  { id: "a", name: "orangecat", mine: false },
  { id: "c", name: "peer-site", mine: false },
  { id: "b", name: "loki", mine: false },
];

const merged = mergeVisibleProjects(own, org);
assert.deepEqual(
  merged.map((p) => p.id),
  ["a", "b", "c"],
);
console.log("  ✓ each project appears once, own first, order kept");

assert.ok(merged.filter((p) => p.id !== "c").every((p) => p.mine));
console.log("  ✓ the own row wins over the org copy of it");

assert.deepEqual(
  mergeVisibleProjects([], org).map((p) => p.id),
  ["a", "c", "b"],
);
assert.deepEqual(
  mergeVisibleProjects(own, []).map((p) => p.id),
  ["a", "b"],
);
console.log("  ✓ either list may be empty");
