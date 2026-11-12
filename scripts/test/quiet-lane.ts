/**
 * A silent run does not hold its project against a waiting message.
 *
 * Production, 2026-11-12: four messages sent through Loki's own chat to
 * `loki` and `orangecat` each read "This project is still on an earlier task"
 * and were still queued 25 to 35 minutes later. The run ahead had an agent
 * process sitting at its prompt, so the reaper sheltered it for up to twelve
 * hours and the gate waited for the reaper.
 *
 * These pin the rule (lib/orchestration/quiet-lane) and where it is applied.
 * The SQL that gathers its facts is exercised against a real Postgres in
 * scripts/test/lane-and-reaper.ts.
 *
 * Run: npx tsx scripts/test/quiet-lane.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  QUIET_LANE_CONFIRM_MS,
  QUIET_LANE_MINUTES,
  QUIET_LANE_MS,
  lastSignOfLifeMs,
  quietLaneReason,
  quietLaneStep,
  type QuietLaneFacts,
} from "@/lib/orchestration/quiet-lane";
import { RUN_PROGRESS_BEAT_MS, RUN_PROGRESS_FRESH_MS } from "@/lib/run-progress";
import { QUEUED_BEHIND_SENTENCE } from "@/lib/dispatch-status";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const NOW = Date.parse("2026-11-12T11:00:00Z");
const min = (n: number) => NOW - n * 60_000;
const facts = (over: Partial<QuietLaneFacts>): QuietLaneFacts => ({
  deliveredAtMs: min(90),
  lastProgressAtMs: min(40),
  blocked: null,
  hasOutstandingCommand: false,
  quietSeenAtMs: null,
  ...over,
});

check("a working agent keeps its lane, however long it has run", () => {
  // Eleven hours in and still printing: the last beat is seconds old.
  const step = quietLaneStep(
    facts({ deliveredAtMs: min(11 * 60), lastProgressAtMs: NOW - RUN_PROGRESS_BEAT_MS }),
    NOW,
  );
  assert(step.kind === "hold", `a run that beat 45 s ago was ${step.kind}`);
});

check("silence shorter than the window holds", () => {
  const step = quietLaneStep(facts({ lastProgressAtMs: NOW - QUIET_LANE_MS + 1000 }), NOW);
  assert(step.kind === "hold", `one second short of the window was ${step.kind}`);
});

check("the window is longer than the one after which the product says Stalled", () => {
  assert(QUIET_LANE_MS > RUN_PROGRESS_FRESH_MS, "a run still reading Working must never be closed");
  assert(
    QUIET_LANE_MINUTES === 20,
    `the sentences say twenty minutes; it is ${QUIET_LANE_MINUTES}`,
  );
});

check("silent with a message waiting is first noted, not closed", () => {
  const step = quietLaneStep(facts({}), NOW);
  assert(step.kind === "mark", `first sight of a silent run was ${step.kind}`);
});

check("still silent after the confirmation window: released, from its last beat", () => {
  const early = quietLaneStep(facts({ quietSeenAtMs: NOW - QUIET_LANE_CONFIRM_MS + 1000 }), NOW);
  assert(early.kind === "hold", `inside the confirmation window it was ${early.kind}`);
  const step = quietLaneStep(facts({ quietSeenAtMs: NOW - QUIET_LANE_CONFIRM_MS }), NOW);
  assert(step.kind === "release", `after the confirmation window it was ${step.kind}`);
  assert(
    step.kind === "release" && step.quietSinceMs === min(40),
    "the run ended when the agent last printed, not when this noticed",
  );
});

check("a beat after the note starts the confirmation again", () => {
  // Noted silent an hour ago, then the agent printed for a while and stopped.
  const step = quietLaneStep(facts({ quietSeenAtMs: min(60), lastProgressAtMs: min(30) }), NOW);
  assert(step.kind === "mark", `a note older than the last beat released at once: ${step.kind}`);
});

check("a run that never printed is timed from delivery", () => {
  assert(
    lastSignOfLifeMs({ deliveredAtMs: min(25), lastProgressAtMs: null }) === min(25),
    "delivery is the floor",
  );
  const step = quietLaneStep(
    facts({ deliveredAtMs: min(25), lastProgressAtMs: null, quietSeenAtMs: min(2) }),
    NOW,
  );
  assert(step.kind === "release", `delivered 25 min ago and silent since was ${step.kind}`);
});

check("a run whose prompt never reached an agent holds", () => {
  const step = quietLaneStep(facts({ deliveredAtMs: null, lastProgressAtMs: null }), NOW);
  assert(step.kind === "hold", `an undelivered run was ${step.kind}`);
});

check("a run the runner is delivering to holds", () => {
  const step = quietLaneStep(facts({ hasOutstandingCommand: true, quietSeenAtMs: min(5) }), NOW);
  assert(step.kind === "hold", `a run with a command outstanding was ${step.kind}`);
});

check("an agent waiting for a person at a sign-in or an approval holds", () => {
  for (const blocked of ["auth", "permission"]) {
    const step = quietLaneStep(facts({ blocked, quietSeenAtMs: min(5) }), NOW);
    assert(step.kind === "hold", `blocked=${blocked} was ${step.kind}`);
  }
});

check("the sentence says how long and what happened next, in plain words", () => {
  const s = quietLaneReason(min(40), NOW);
  assert(/printed nothing for 40 minutes/.test(s), s);
  assert(/next message for the project started/.test(s), s);
  assert(!/reap|lane|gate|stale/i.test(s), `internal vocabulary in: ${s}`);
});

check("a person waiting behind a run is told the bound", () => {
  assert(
    QUEUED_BEHIND_SENTENCE.includes(`printed nothing for ${QUIET_LANE_MINUTES} minutes`),
    `the waiting sentence does not say when a silent task gives way: ${QUEUED_BEHIND_SENTENCE}`,
  );
});

check("the claim releases a quiet lane before it reads the gate", () => {
  const src = read("src/db/queries/pending-commands.ts");
  const release = src.indexOf("await releaseQuietLanes(userIds)");
  const gate = src.indexOf("fifoEligibilitySql()", release);
  assert(release > 0, "claimNextPendingCommand does not call releaseQuietLanes");
  assert(gate > release, "the release must run before the gate is read");
});

check("the facts come from the gate's own definition of who is ahead", () => {
  const src = read("src/db/queries/quiet-lane.ts");
  assert(/olderOpenRunSql\(/.test(src), "the head of the lane is not read through olderOpenRunSql");
  assert(/quietLaneStep\(facts, nowMs\)/.test(src), "the decision is not the pure rule");
  assert(
    /lastProgressAt', ''\) = \$\{row\.last_progress_at \?\? ""\}/.test(src),
    "a beat between the read and the write must keep the run",
  );
});

if (failures) {
  console.log(`\nquiet-lane: ${failures} failed`);
  process.exit(1);
}
console.log("\nquiet-lane: all passed");
