/**
 * The numbers the Activity page leads with.
 *
 * These are the claims the page makes before anyone scrolls — a headline, a
 * momentum phrase, and a pulse chart. Each one is a promise about reality, so
 * each one is pinned here: the headline must never celebrate a window that also
 * contains failures, momentum must refuse to call 1 -> 2 a trend, and the pulse
 * must never drop an event it cannot place (bars that disagree with the count
 * printed above them are worse than no chart).
 *
 * Run: npx tsx scripts/test/activity-summary.ts (or npm run test:unit)
 */
import assert from "node:assert/strict";
import { buildActivityEvents, type RunSource } from "@/lib/activity-events";
import {
  activityHeadline,
  buildActivityPulse,
  computeMomentum,
  formatAgentTime,
  pulseBucketCount,
  summarizeActivity,
} from "@/lib/activity-summary";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ${label}`);
};

const T0 = new Date("2026-08-26T00:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const HOUR = 3_600_000;

function run(over: Partial<RunSource> = {}): RunSource {
  return {
    id: Math.random().toString(36).slice(2),
    projectKey: "alpha",
    adapter: "claude",
    intent: "next_best",
    state: "done",
    outcome: "success",
    summary: null,
    payload: null,
    startedAt: T0,
    finishedAt: at(60_000),
    ...over,
  };
}

console.log("summarizeActivity");

check("counts each outcome into exactly one bucket", () => {
  const events = buildActivityEvents({
    prompts: [],
    runs: [
      run({ projectKey: "a", outcome: "success" }),
      run({ projectKey: "b", outcome: "success" }),
      run({ projectKey: "c", outcome: "error" }),
      run({ projectKey: "d", outcome: "running", state: "running", finishedAt: null }),
    ],
  });
  const s = summarizeActivity(events);
  assert.equal(s.shipped, 2);
  assert.equal(s.attention, 1);
  assert.equal(s.running, 1);
  assert.equal(s.projects, 4);
});

check("a partial run counts as needing attention, never as shipped", () => {
  const events = buildActivityEvents({ prompts: [], runs: [run({ outcome: "partial" })] });
  const s = summarizeActivity(events);
  assert.equal(s.shipped, 0);
  assert.equal(s.attention, 1);
});

check("agent time sums real run durations", () => {
  const events = buildActivityEvents({
    prompts: [],
    runs: [
      run({ projectKey: "a", startedAt: T0, finishedAt: at(30 * 60_000) }),
      run({ projectKey: "b", startedAt: T0, finishedAt: at(90 * 60_000) }),
    ],
  });
  assert.equal(summarizeActivity(events).agentLabel, "2h");
});

check("a tied 'busiest project' is reported as none rather than picked at random", () => {
  const events = buildActivityEvents({
    prompts: [],
    runs: [run({ projectKey: "a" }), run({ projectKey: "b" })],
  });
  assert.equal(summarizeActivity(events).busiestProject, null);
});

check("a clear leader is named", () => {
  const events = buildActivityEvents({
    prompts: [],
    runs: [run({ projectKey: "a" }), run({ projectKey: "a" }), run({ projectKey: "b" })],
  });
  assert.equal(summarizeActivity(events).busiestProject, "a");
});

console.log("\nformatAgentTime");

check("reads in units a person thinks in", () => {
  assert.equal(formatAgentTime(0), null);
  assert.equal(formatAgentTime(30_000), "under a minute");
  assert.equal(formatAgentTime(38 * 60_000), "38m");
  assert.equal(formatAgentTime(2 * HOUR), "2h");
  assert.equal(formatAgentTime(4 * HOUR + 12 * 60_000), "4h 12m");
});

console.log("\nactivityHeadline");

const base = {
  shipped: 0,
  attention: 0,
  running: 0,
  queued: 0,
  projects: 0,
  agentMs: 0,
  agentLabel: null,
  busiestProject: null,
};

check("failures lead, always", () => {
  const line = activityHeadline({ ...base, attention: 2, shipped: 5, projects: 3 });
  // "runs", not "things": only the front door says "N things need you".
  assert.ok(line.startsWith("2 runs need you"), line);
});

check("a window with failures never opens by celebrating", () => {
  const line = activityHeadline({ ...base, attention: 1, shipped: 9, projects: 4 });
  assert.ok(!line.startsWith("9"), line);
  assert.ok(line.includes("shipped anyway"), line);
});

check("a clean window leads with what shipped", () => {
  const line = activityHeadline({ ...base, shipped: 3, projects: 2 });
  assert.equal(line, "3 tasks shipped across 2 projects.");
});

check("singulars read correctly", () => {
  assert.equal(
    activityHeadline({ ...base, shipped: 1, projects: 1 }),
    "1 task shipped on one project.",
  );
  assert.equal(activityHeadline({ ...base, attention: 1 }), "1 run needs you.");
  assert.equal(activityHeadline({ ...base, running: 1 }), "1 agent is working right now.");
});

check("work waiting on a builder is surfaced, not silently dropped", () => {
  assert.ok(activityHeadline({ ...base, queued: 2 }).includes("waiting on a builder"));
});

check("an empty window says so plainly", () => {
  assert.equal(activityHeadline(base), "Nothing ran in this window.");
});

console.log("\ncomputeMomentum");

check("refuses to call a tiny change a trend", () => {
  assert.equal(computeMomentum(2, 1).label, "about the same as last window");
});

check("reports a real swing with its direction", () => {
  assert.equal(computeMomentum(20, 10).label, "100% busier than last window");
  assert.equal(computeMomentum(5, 20).label, "75% quieter than last window");
});

check("a huge swing is told as counts, not '967% busier'", () => {
  assert.equal(computeMomentum(64, 6).label, "up from 6 the window before");
  assert.equal(computeMomentum(30, 10).label, "200% busier than last window");
});

check("no previous activity is not '+100%'", () => {
  assert.equal(computeMomentum(9, 0).label, "first activity after a quiet window");
  assert.equal(computeMomentum(9, 0).deltaPct, null);
});

check("two empty windows say nothing at all", () => {
  assert.equal(computeMomentum(0, 0).label, null);
});

console.log("\nbuildActivityPulse");

const dayEvents = buildActivityEvents({
  prompts: [],
  runs: [
    run({ projectKey: "a", startedAt: at(2 * HOUR), finishedAt: at(2 * HOUR + 1000) }),
    run({ projectKey: "b", startedAt: at(2 * HOUR), finishedAt: at(2 * HOUR + 1000) }),
    run({
      projectKey: "c",
      startedAt: at(5 * HOUR),
      finishedAt: at(5 * HOUR + 1000),
      outcome: "error",
    }),
  ],
});

check("every event lands in a bucket — the bars must match the count above them", () => {
  const pulse = buildActivityPulse(dayEvents, T0.toISOString(), at(24 * HOUR).toISOString(), 24);
  const summed = pulse.buckets.reduce((n, b) => n + b.total, 0);
  assert.equal(summed, dayEvents.length);
});

check("buckets are placed by time, and zero buckets are kept", () => {
  const pulse = buildActivityPulse(dayEvents, T0.toISOString(), at(24 * HOUR).toISOString(), 24);
  assert.equal(pulse.buckets.length, 24, "a pulse with gaps omitted would read as continuous work");
  assert.equal(pulse.buckets[2].total, 2);
  assert.equal(pulse.buckets[5].total, 1);
  assert.equal(pulse.buckets[0].total, 0);
  assert.equal(pulse.peak, 2);
});

check("attention is tracked per bucket, for the failure tick", () => {
  const pulse = buildActivityPulse(dayEvents, T0.toISOString(), at(24 * HOUR).toISOString(), 24);
  assert.equal(pulse.buckets[5].attention, 1);
  assert.equal(pulse.buckets[2].attention, 0);
});

check("an event on the far boundary is clamped in, never dropped", () => {
  const edge = buildActivityEvents({
    prompts: [],
    runs: [run({ startedAt: at(24 * HOUR), finishedAt: at(24 * HOUR + 1) })],
  });
  const pulse = buildActivityPulse(edge, T0.toISOString(), at(24 * HOUR).toISOString(), 24);
  assert.equal(
    pulse.buckets.reduce((n, b) => n + b.total, 0),
    1,
  );
});

check("a degenerate range yields no chart rather than a divide-by-zero", () => {
  const pulse = buildActivityPulse(dayEvents, T0.toISOString(), T0.toISOString(), 24);
  assert.deepEqual(pulse.buckets, []);
  assert.equal(pulse.peak, 0);
});

check("bucket counts are units people think in", () => {
  assert.equal(pulseBucketCount("hour"), 12);
  assert.equal(pulseBucketCount("day"), 24);
  assert.equal(pulseBucketCount("week"), 7);
  assert.equal(pulseBucketCount("month"), 30);
});

console.log(`\n${passed}/${passed} activity-summary cases passed`);
