/**
 * The fleet brief's fallback snapshot must be valid and recent.
 *
 * At dispatch time the brief reads bitbaum/fleet live and only falls back to
 * src/lib/fleet-brief/snapshot.generated.json when GitHub is slow or down. A
 * fallback nobody refreshes quietly becomes the copy the fleet's "one
 * producer per fact" rule forbids: it keeps naming a package that was retired,
 * or misses the one that would have stopped the next hand-written duplicate.
 * So it ages out loudly here, in CI, instead of silently in a prompt.
 *
 * Fix a failure with: pnpm run generate:fleet-brief
 *
 * Run: npx tsx scripts/test/fleet-brief-snapshot-fresh.ts
 */
import assert from "node:assert/strict";
import { loadSnapshot } from "../../src/lib/fleet-brief/brief";

/** How old the fallback may get before CI refuses it. */
const MAX_AGE_DAYS = 45;
const DAY_MS = 86_400_000;

const snapshot = loadSnapshot(); // throws (fails) on a malformed file
const fetchedAt = Date.parse(snapshot.fetchedAt);
assert.ok(Number.isFinite(fetchedAt), "fetchedAt is a date");
const ageDays = (Date.now() - fetchedAt) / DAY_MS;
assert.ok(ageDays > -1, `fetchedAt ${snapshot.fetchedAt} is in the future`);
assert.ok(
  ageDays <= MAX_AGE_DAYS,
  `fleet brief snapshot is ${Math.floor(ageDays)} days old (limit ${MAX_AGE_DAYS}). ` +
    "Run `pnpm run generate:fleet-brief` and commit src/lib/fleet-brief/snapshot.generated.json.",
);
console.log(
  `fleet-brief-snapshot-fresh: ok (${snapshot.packages.length} packages, ${snapshot.stack.length} stack rows, ${Math.floor(ageDays)}d old, limit ${MAX_AGE_DAYS}d)`,
);
