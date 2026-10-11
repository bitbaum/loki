/**
 * Every cron ROUTE has a TIMER, and every timer has a route.
 * Run: npx tsx scripts/test/cron-schedule-coverage.ts
 *
 * The class this closes: a cron endpoint can be written, reviewed, merged and
 * deployed while nothing on the box ever calls it. It is invisible because it
 * looks exactly like a working feature — the code is there, the route responds
 * if you curl it, and the only symptom is that the job silently never runs.
 * "Gates cannot see absence": no existing check could notice a job that was
 * never scheduled, because there is nothing to inspect.
 *
 * The discriminator is `requireCronAuth`. A route under api/crons/ that uses it
 * is machine-driven and MUST be on a timer; the session-authed ones (the cron
 * CRUD endpoints a human's browser calls) must NOT be. That is a property of
 * the code rather than a hand-maintained exclusion list, so it cannot rot.
 *
 * The reverse direction matters just as much: a timer naming a route that no
 * longer exists fails every night into a log nobody reads.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const CRON_DIR = "src/app/api/crons";
const INSTALLER = "scripts/install-hetzner-crons.sh";

// ── Routes that are machine-driven (they demand cron auth) ───────────────────
const scheduledRoutes = readdirSync(CRON_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((name) => {
    const file = `${CRON_DIR}/${name}/route.ts`;
    return existsSync(file) && readFileSync(file, "utf8").includes("requireCronAuth");
  })
  .sort();

assert.ok(
  scheduledRoutes.length >= 10,
  `expected the cron directory to hold many jobs, found ${scheduledRoutes.length} — has the layout moved?`,
);

// ── Names the installer actually creates timers for ──────────────────────────
const installer = readFileSync(INSTALLER, "utf8");
const schedLine = installer.split("\n").find((l) => l.includes("declare -A SCHED="));
assert.ok(schedLine, `no 'declare -A SCHED=' line in ${INSTALLER} — the schedule table moved`);

const scheduledNames = [...schedLine.matchAll(/\[([a-z0-9-]+)\]=/g)].map((m) => m[1]).sort();
assert.ok(
  scheduledNames.length > 0,
  "parsed zero timer names — the regex no longer matches the table",
);

// ── 1. No route without a timer ──────────────────────────────────────────────
const unscheduled = scheduledRoutes.filter((r) => !scheduledNames.includes(r));
assert.deepEqual(
  unscheduled,
  [],
  `cron route(s) with NO timer — they will never run:\n  ${unscheduled.join("\n  ")}\n` +
    `Add each to the SCHED table in ${INSTALLER}.`,
);

// ── 2. No timer without a route ──────────────────────────────────────────────
const orphanTimers = scheduledNames.filter((n) => !scheduledRoutes.includes(n));
assert.deepEqual(
  orphanTimers,
  [],
  `timer(s) pointing at a route that does not exist — they fail nightly into a log:\n  ${orphanTimers.join("\n  ")}`,
);

// ── 3. The rot checker specifically is scheduled ─────────────────────────────
// Named explicitly because this test was written the day it was added, and a
// generic "counts match" assertion would still pass if it were dropped.
assert.ok(
  scheduledNames.includes("check-model-ids"),
  "check-model-ids has no timer — model rot goes back to being found by hand",
);

// ── 4. A timer in SCHED reaches the box without anyone running anything ─────
// Sections 1–3 prove every route is in SCHED. They could not see the last step:
// SCHED only became timers when someone ran the installer by hand, so the
// 19:00 evening proposal (2026-10-10) merged, deployed, passed every check here,
// and had no timer on the box. The deploy runs the installer now; this keeps it.
const DEPLOY = "scripts/deploy-hetzner.sh";
assert.match(
  readFileSync(DEPLOY, "utf8"),
  /^[^#\n]*bash "\$PROJECT_DIR\/scripts\/install-hetzner-crons\.sh"/m,
  `${DEPLOY} no longer runs ${INSTALLER} — a new job would merge with no timer on the box`,
);

console.log(
  `✓ cron schedule coverage: ${scheduledRoutes.length} cron-authed route(s), all timered; no orphan timers; the deploy installs them`,
);
