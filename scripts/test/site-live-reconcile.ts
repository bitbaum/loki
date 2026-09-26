/**
 * A site that went live after registration gets recorded, and its owner is told.
 *
 * Farmhouse (2026-09-26): the first deploy failed, a later one succeeded, and
 * nothing looked again — no live URL, a "Live" link that opened the OrangeCat
 * listing, and no word to the owner. These pin the wiring that closes it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lib = readFileSync("src/lib/site-live-reconcile.ts", "utf8");
// Same evidence registration uses — a hostname alone is not a site.
assert.match(lib, /checkProjectSiteDeployment\(/);
assert.match(lib, /result\.deploymentStatus !== "live"\) return "not_live"/);
// Only projects that still lack a live URL; writing it is what ends the check,
// so the announcement cannot repeat.
assert.match(lib, /isNull\(userProjects\.liveUrl\)/);
// The owner's link carries their pass; Telegram is the operator's own chat.
assert.match(lib, /ownerSiteUrl\(liveUrl, createOwnerPass\(entityProjectId, userId\)\)/);
assert.match(lib, /!\(await isSiteOperator\(userId\)/);

const crons = readFileSync("scripts/install-hetzner-crons.sh", "utf8");
assert.match(crons, /\[check-site-live\]="\*:25"/, "the cron has a timer");
assert.match(
  readFileSync("src/app/api/crons/check-site-live/route.ts", "utf8"),
  /requireCronAuth\(req\)/,
);

const page = readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8");
assert.match(page, /void reconcileSiteLiveUrl\(/, "the page never waits on GitHub");

console.log("site-live-reconcile: ok");
