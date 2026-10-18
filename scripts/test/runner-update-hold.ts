/**
 * While the cloud builder runs code older than this deploy, the commands
 * route hands it no new work — or the restart it waits for never comes
 * (lib/runner-update-hold).
 *
 * Run: npx tsx scripts/test/runner-update-hold.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FLEET_RUNNER_COMMAND_TYPES } from "@/lib/pending-command-contract";
import { claimableTypes, HELD_WHILE_UPDATING, holdsNewWork } from "@/lib/runner-update-hold";

// What starts work waits; what a person is waiting on this second does not.
for (const t of ["dispatch", "launch_agent", "auto_continue", "browser_task"])
  assert.equal(holdsNewWork(t), true, `${t} starts work and waits for the restart`);
for (const t of ["inject", "close_tab", "peek_tab", "peek_start", "peek_stop", "switch_agent"])
  assert.equal(holdsNewWork(t), false, `${t} is a person at the screen and is never held`);
assert.equal(holdsNewWork("something_new"), false, "an unknown type is not held by accident");
for (const t of HELD_WHILE_UPDATING)
  assert.ok((FLEET_RUNNER_COMMAND_TYPES as readonly string[]).includes(t), `${t} is a command`);

// The claim list: what the runner asked for, minus the work-starters while
// it is behind; everything it asked for once it is current.
const asked = ["inject", "dispatch", "peek_start", "auto_continue"];
assert.deepEqual(claimableTypes(asked, false), asked, "current: exactly what it asked for");
assert.deepEqual(claimableTypes(asked, true), ["inject", "peek_start"], "behind: no work-starters");
assert.deepEqual(claimableTypes(undefined, false), FLEET_RUNNER_COMMAND_TYPES, "no list: all");
assert.ok(!claimableTypes(undefined, true).includes("dispatch"), "no list, behind: still held");
assert.ok(claimableTypes([], true).includes("inject"), "an empty list reads as all");

// The route applies it to the CLOUD channel from the runner's own heartbeat
// version, so a runner that predates this rule is held by it too.
const route = readFileSync("src/app/api/control/commands/route.ts", "utf8");
assert.match(route, /runnerChannel === "cloud"/, "the hold is the cloud builder's");
assert.match(route, /builderBehind\(/, "behind = the heartbeat version against the deploy's");
assert.match(route, /claimableTypes\(requested, holding\)/, "the claim asks for the held list");

console.log(
  "✓ runner-update-hold: a builder behind the deploy starts no new work until it restarts",
);
