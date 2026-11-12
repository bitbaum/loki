/**
 * An agent idle at its prompt does not hold its project's queue, and a task
 * that waits says what it waits on and since when.
 *
 * Grok Bot's dogfood, 2026-11-12: two /api/inject prompts to orangecat (08:10
 * and 09:21 Zurich) read Queued for over an hour "behind an earlier task",
 * while that session had been idle since 06:17; the 10:25 answer promised
 * "starts in 5 minutes at the latest", which was not true.
 *
 * - The runner beat on any byte, and an idle session trickles 40–96 bytes a
 *   minute (#1676), so lastProgressAt never went stale. A beat under
 *   RUN_PROGRESS_MIN_BYTES no longer counts as work.
 * - The project's live process sheltered the run for up to 12 hours. The run's
 *   own beats decide now: idle for RUN_IDLE_RELEASE_MINUTES releases the lane
 *   (gate, blocker lookup and reaper read one definition). The database half
 *   is in scripts/test/lane-and-reaper.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  RUN_BLOCKED,
  RUN_IDLE_RELEASE_MINUTES,
  RUN_PROGRESS_HORIZON_SECONDS,
  RUN_PROGRESS_MAX_MS,
  RUN_PROGRESS_MIN_BYTES,
  RUN_WENT_QUIET_SENTENCE,
  isWorkingBeat,
} from "../../src/lib/run-progress";
import {
  QUEUED_BEHIND_SENTENCE,
  queuedBehindLabel,
  queuedBehindSentence,
  zurichClock,
} from "../../src/lib/dispatch-status";

const read = (p: string) => fs.readFileSync(p, "utf8");

// ── a trickle is not work ──────────────────────────────────────────────────
assert.equal(isWorkingBeat({ outputBytes: 96, blocked: null }), false, "idle trickle");
assert.equal(isWorkingBeat({ outputBytes: 0, blocked: null }), false);
assert.equal(isWorkingBeat({ outputBytes: RUN_PROGRESS_MIN_BYTES, blocked: null }), true);
assert.equal(isWorkingBeat({ outputBytes: 48_000, blocked: null }), true, "a spinner and text");
assert.equal(
  isWorkingBeat({ outputBytes: 0, blocked: RUN_BLOCKED.PERMISSION }),
  true,
  "a block is always said",
);
assert.equal(RUN_IDLE_RELEASE_MINUTES, 30);
assert.match(RUN_WENT_QUIET_SENTENCE, /30 minutes/);

// ── what a queued task is told ─────────────────────────────────────────────
const now = new Date("2026-11-12T09:25:00Z"); // 10:25 Zurich
const sentence = queuedBehindSentence(
  {
    label: "Fix the share card",
    startedAt: "2026-11-12T05:02:00Z",
    lastProgressAt: "2026-11-12T05:17:00Z",
  },
  now,
);
assert.match(sentence, /“Fix the share card”/, "names the run it waits behind");
assert.match(sentence, /open since 06:02/, "since when, in Zurich time");
assert.match(sentence, /last printed work at 06:17/, "when it last worked");
assert.match(sentence, /no work for 30 minutes/, "the rule that ends the wait");
assert.doesNotMatch(sentence, /5 minutes|shortly/);
assert.equal(
  queuedBehindSentence(null, now),
  QUEUED_BEHIND_SENTENCE,
  "no facts, the general sentence",
);
assert.match(
  queuedBehindSentence({ label: null, startedAt: now, lastProgressAt: null }, now),
  /still on an earlier task, open since 10:25\. Yours/,
);
assert.equal(
  queuedBehindLabel({ label: "Fix", startedAt: "2026-11-12T05:02:00Z", lastProgressAt: null }, now),
  "Next in line, behind “Fix” (open since 06:02)",
);
assert.match(zurichClock("2026-11-11T06:00:00Z", now), /11 Nov/, "yesterday says the day");

// ── the wiring ─────────────────────────────────────────────────────────────
const runs = read("src/db/queries/orchestration-runs.ts");
assert.match(runs, /AND NOT \$\{runIdleSql\("r"\)\}/, "the lane: an idle run does not hold it");
assert.match(
  runs,
  /sql`NOT \$\{runIdleSql\("orchestration_runs"\)\}`/,
  "busy agrees with the gate: an idle run does not make its project busy",
);
assert.match(
  runs,
  /OR \$\{idle\} OR \$\{effectiveStart\} < NOW\(\) - make_interval\(hours/,
  "no shelter for idle",
);
assert.match(runs, /payload->>'blocked'\) IS NULL/, "a run asking a person keeps its lane");
assert.match(runs, /payload->>'lastProgressAt'\) IS NOT NULL/, "unknown is not idle");

const progress = read("src/app/api/control/runs/[id]/progress/route.ts");
assert.match(progress, /isWorkingBeat\(\{ outputBytes, blocked \}\)/);
assert.match(progress, /\[branch, upstream\],\s*working,\s*\)/);

const inject = read("src/lib/inject-core.ts");
assert.match(inject, /queuedBehind \? queuedBehindSentence\(blocker\) : null/);
assert.match(
  inject,
  /builderUpdating && !queuedBehind \? BUILDER_UPDATING_SENTENCE : null/,
  "no five-minute promise for a task behind an open run",
);
assert.match(inject, /waitingOn: \{/, "the answer carries what it waits on");
const track = read("src/lib/run-track-load.ts");
assert.match(track, /queuedBehindSentence\(blocker, new Date\(now\)\)/);

// ── three faults in the first rule (review, 2026-11-12) ─────────────────────
// The database half of each is in scripts/test/lane-and-reaper.ts.
// 1. The runner stops beating RUN_PROGRESS_MAX_MS into a run, so silence that
//    begins there is the runner's, not the agent's.
assert.equal(RUN_PROGRESS_HORIZON_SECONDS, RUN_PROGRESS_MAX_MS / 1000 - 300);
assert.match(
  runs,
  /lastProgressAt'\)::timestamptz < \$\{horizon\}/,
  "a last beat at the runner's own stop is not read as the agent stopping",
);
// 2. A turn that ended before the runner began reporting never has a working
//    beat. One the runner does report on (any beat) is idle after the window.
assert.match(runs, /payload->>'lastBeatAt'\) IS NOT NULL/, "reported on, but never worked");
assert.match(
  runs,
  /const seenBeat = sql`jsonb_set\(COALESCE\(payload, '\{\}'\), '\{lastBeatAt\}'/,
  "every beat says the runner is reporting on this run",
);
assert.match(runs, /: seenBeat;/, "a trickle stamps lastBeatAt and leaves lastProgressAt alone");
// 3. The idle run is closed before the task behind it starts, or that task's
//    handoff closes both runs with one summary.
const claim = read("src/db/queries/pending-commands.ts");
const closes = claim.indexOf("await closeIdleRunsAhead(userIds)");
assert.ok(closes > 0, "the claim closes idle runs ahead");
assert.ok(
  claim.indexOf("fifoEligibilitySql()", closes) > closes,
  "and does it before the gate lets the next task through",
);
const idleClose = read("src/db/queries/idle-run-close.ts");
assert.match(idleClose, /\$\{runIdleSql\("r"\)\}/, "one definition of idle");
assert.match(idleClose, /cleanupStaleOrchestrationRuns\(userId\)/, "the reaper's own close");
assert.match(idleClose, /pc\.claimed_at IS NULL/, "only when a task is waiting");

console.log("idle-run-release ok");
