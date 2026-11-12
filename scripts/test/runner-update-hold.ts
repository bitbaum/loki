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
import {
  BUILDER_UPDATING_LABEL,
  BUILDER_UPDATING_SENTENCE,
  claimableTypes,
  HELD_WHILE_UPDATING,
  heldTypes,
  holdsNewWork,
  holdWindowOpen,
  UPDATE_HOLD_MAX_MS,
  UPDATE_HOLD_WINDOW_MS,
  UPDATE_HOLD_MINUTES,
} from "@/lib/runner-update-hold";
import { dispatchAssistantContent, dispatchStatusLabel } from "@/lib/dispatch-status";
import { builderHoldsNewWork } from "@/lib/builder-presence";
import { FLEET_RUNNER_RELEASES } from "@/config/changelog";
import { buildRunTrack, type RunTrackInput } from "@/lib/run-track";

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
assert.match(route, /builderHoldsNewWork\(/, "behind = the heartbeat version against the deploy's");
assert.match(route, /claimableTypes\(requested, holding\)/, "the claim asks for the held list");

// ── The hold ends ────────────────────────────────────────────────────────
// 2026-11-12: the restart never came (five sessions read as working for an
// hour) and every task sat queued with no end. A task now waits at most
// UPDATE_HOLD_MAX_MS, then runs on the code the builder has.
assert.ok(UPDATE_HOLD_MAX_MS > 0 && UPDATE_HOLD_MAX_MS <= 10 * 60_000, "minutes, not hours");
assert.equal(UPDATE_HOLD_MAX_MS, UPDATE_HOLD_MINUTES * 60_000);
assert.deepEqual(heldTypes(asked), ["dispatch", "auto_continue"], "the held ones it asked for");
assert.deepEqual(heldTypes(undefined), [...HELD_WHILE_UPDATING], "no list: every work-starter");
assert.deepEqual(heldTypes(["inject", "peek_start"]), [], "nothing held was asked for");
assert.match(
  route,
  /overdue = holding\s*\?\s*\{ types: heldTypes\(requested\), waitedMs: UPDATE_HOLD_MAX_MS \}/,
  "the route hands over what has waited out the hold",
);
assert.equal(
  (route.match(/claimNextPendingCommand\(userIds, types, runnerChannel, overdue\)/g) ?? []).length,
  2,
  "both the long poll and the single claim apply the bound",
);
const claim = readFileSync("src/db/queries/pending-commands.ts", "utf8");
assert.match(
  claim,
  /lt\(pendingCommands\.createdAt, new Date\(Date\.now\(\) - overdue\.waitedMs\)\)/,
  "overdue = queued longer ago than the bound",
);
assert.match(
  claim,
  /atOnce \?\? sql`false`/,
  "while holding, an empty at-once list claims nothing",
);

// ── And the hold itself ends ─────────────────────────────────────────────
// A builder still behind two hours after the release is not about to
// restart; holding every task for the bound would be a tax with no return.
const released = "2026-11-12T04:45:00Z";
const t0 = Date.parse(released);
assert.equal(holdWindowOpen(released, t0 + 60_000), true, "just released: held");
assert.equal(holdWindowOpen(released, t0 + UPDATE_HOLD_WINDOW_MS - 1), true);
assert.equal(holdWindowOpen(released, t0 + UPDATE_HOLD_WINDOW_MS), false, "window over: no hold");
assert.equal(holdWindowOpen(undefined, t0), true, "no date: each task is still bounded");
assert.equal(holdWindowOpen("not a date", t0), true);
assert.equal(
  builderHoldsNewWork("box-0.0.1", Date.parse(FLEET_RUNNER_RELEASES[0]!.date) + 1),
  true,
);
assert.equal(
  builderHoldsNewWork(
    "box-0.0.1",
    Date.parse(FLEET_RUNNER_RELEASES[0]!.date) + UPDATE_HOLD_WINDOW_MS,
  ),
  false,
  "behind, but the release is old: work starts at once",
);
assert.equal(
  builderHoldsNewWork(
    `box-${FLEET_RUNNER_RELEASES[0]!.version}`,
    Date.parse(FLEET_RUNNER_RELEASES[0]!.date) + 1,
  ),
  false,
  "current: nothing to hold",
);

// ── And the person is told ───────────────────────────────────────────────
assert.match(BUILDER_UPDATING_SENTENCE, new RegExp(`${UPDATE_HOLD_MINUTES} minutes at the latest`));
const held = { ok: true, mode: "queued", runnerConnected: true, channel: "cloud" as const };
assert.match(
  dispatchAssistantContent("loki", held),
  /will claim it shortly/,
  "a current runner: starting shortly",
);
const told = dispatchAssistantContent("loki", { ...held, builderUpdating: true });
assert.ok(told.includes(BUILDER_UPDATING_SENTENCE), "a held task says why and for how long");
assert.doesNotMatch(told, /shortly/, "and never promises shortly");
assert.equal(dispatchStatusLabel({ ...held, builderUpdating: true }).label, BUILDER_UPDATING_LABEL);
assert.equal(dispatchStatusLabel({ ...held, builderUpdating: true }).warn, false, "not a fault");

const queuedRun: RunTrackInput = {
  eventKinds: [],
  eventTimes: {},
  run: { startedAt: new Date().toISOString(), finishedAt: null, outcome: null },
  askedAt: new Date().toISOString(),
  phase: null,
  stalled: false,
  lastProgressAt: null,
  needsYou: null,
  builderLabel: "the cloud runner",
  evidence: null,
  fix: null,
  liveUrl: null,
  providerLabel: "Claude Code",
  failure: null,
};
assert.match(buildRunTrack(queuedRun).summary, /usually under a minute/);
for (const stalled of [false, true]) {
  const t = buildRunTrack({ ...queuedRun, stalled, queueNote: BUILDER_UPDATING_SENTENCE });
  assert.equal(t.summary, BUILDER_UPDATING_SENTENCE, "the track's headline is the reason");
  const builder = t.stages.find((x) => x.id === "builder");
  assert.equal(builder?.label, "Waiting for the runner's update");
  assert.notEqual(builder?.state, "attention", "a bounded wait is not a fault");
}
const inject = readFileSync("src/lib/inject-core.ts", "utf8");
assert.match(inject, /builderUpdating: true/, "the inject answer carries the fact");
assert.match(
  readFileSync("src/lib/run-track-load.ts", "utf8"),
  /queueNote: waitingOnUpdate \? BUILDER_UPDATING_SENTENCE : null/,
  "the track is given the reason while the job is unclaimed",
);

console.log(
  "✓ runner-update-hold: a builder behind the deploy holds new work for minutes, not for ever, and says so",
);
