/**
 * The build as one line above the box.
 *
 * Run: npx tsx scripts/test/workbench-state-line.ts
 */
import assert from "node:assert/strict";
import { IDLE_STATE_LINE, stateLine } from "../../src/lib/workbench/state-line";

// Nothing known, nothing running: the idle line.
assert.deepEqual(stateLine(null), IDLE_STATE_LINE);
assert.deepEqual(stateLine({ run: null, status: null, track: null }), IDLE_STATE_LINE);

// A track says it best: its own summary, toned by the stage it is on.
const track = {
  summary: "Pull request open",
  current: "pr",
  settled: false,
  stages: [
    { id: "asked", state: "done" as const },
    { id: "pr", state: "now" as const },
    { id: "live", state: "next" as const },
  ],
};
assert.deepEqual(stateLine({ track }), {
  text: "Pull request open",
  tone: "positive",
  moving: true,
});
assert.equal(
  stateLine({ track: { ...track, current: "pr", stages: [{ id: "pr", state: "attention" }] } })
    .tone,
  "warning",
);
assert.equal(
  stateLine({ track: { ...track, current: "pr", stages: [{ id: "pr", state: "failed" }] } }).tone,
  "negative",
);
assert.equal(stateLine({ track: { ...track, settled: true } }).moving, false);

// No track yet: the run's status, toned by what it says.
assert.deepEqual(
  stateLine({ run: { live: true }, status: { label: "Working", stalled: false, error: null } }),
  { text: "Working", tone: "positive", moving: true },
);
assert.equal(
  stateLine({ run: { live: true }, status: { label: "Quiet", stalled: true, error: null } }).tone,
  "warning",
);
assert.equal(
  stateLine({ run: { live: false }, status: { label: "Failed", stalled: false, error: "x" } }).tone,
  "negative",
);
assert.equal(
  stateLine({ run: { live: false }, status: { label: "Done", stalled: false, error: null } })
    .moving,
  false,
);

console.log("workbench-state-line: ok");
