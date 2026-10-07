// Verifies the one derived answer to "is something being built?"
// (src/lib/project-build-status.ts). The cases are the ones observed on the
// box for one project on 2026-09-13/14: a runner row frozen at "running" two
// hours after the agent died, an open run nobody picked up, and a timed-out
// run that left nothing in the repo.
// Run: npx tsx scripts/test/project-build-status.ts
import {
  BUILD_QUEUED_GRACE_MS,
  deriveBuildStatus,
  isBuildActive,
  projectStateKeys,
} from "@/lib/project-build-status";
import { RUNNER_OFFLINE_THRESHOLD_MS } from "@/lib/constants/runner";
import { MINUTE_MS } from "@/lib/constants/time";

let pass = 0;
let fail = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.error(`✗ ${label}: expected ${e}, got ${a}`);
  }
}

const NOW = Date.parse("2026-09-14T02:00:00Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * MINUTE_MS);

function run(over: {
  startedMinutesAgo: number;
  finishedMinutesAgo?: number | null;
  outcome?: string | null;
  commit?: string;
  error?: string;
}) {
  return {
    startedAt: at(over.startedMinutesAgo),
    finishedAt: over.finishedMinutesAgo == null ? null : at(over.finishedMinutesAgo),
    outcome: over.outcome ?? null,
    state: over.finishedMinutesAgo == null ? "running" : "closed",
    summary: over.commit ? { commit: over.commit } : null,
    payload: over.error ? { error: over.error } : null,
  };
}

// ── Building: only a FRESH runner observation counts ────────────────────────
eq(
  deriveBuildStatus({
    state: {
      agentRunning: true,
      runtimeObservedAt: at(2),
      currentPromptLabel: "Start building",
      currentPromptStartedAt: at(9),
    },
    runs: [],
    commits: null,
    nowMs: NOW,
  }),
  { kind: "building", sinceMs: NOW - 9 * MINUTE_MS, label: "Start building" },
  "fresh agentRunning → building",
);

// The observed lie: agent_running=t observed at 23:05, page opened at 02:00.
eq(
  deriveBuildStatus({
    state: {
      agentRunning: true,
      runtimeObservedAt: new Date(NOW - RUNNER_OFFLINE_THRESHOLD_MS - 1),
      currentPromptLabel: null,
      currentPromptStartedAt: null,
    },
    runs: [],
    commits: null,
    nowMs: NOW,
  }).kind,
  "idle",
  "expired agentRunning claim is not building",
);

eq(
  deriveBuildStatus({
    state: {
      agentRunning: false,
      runtimeObservedAt: at(1),
      currentPromptLabel: null,
      currentPromptStartedAt: null,
    },
    runs: [],
    commits: null,
    nowMs: NOW,
  }),
  { kind: "idle", last: null },
  "fresh but not running, nothing ever ran → idle with no last attempt",
);

// ── Open runs: queued inside the grace window, stalled past it ──────────────
eq(
  deriveBuildStatus({
    state: null,
    runs: [run({ startedMinutesAgo: 3 })],
    commits: null,
    nowMs: NOW,
  }),
  { kind: "queued", sinceMs: NOW - 3 * MINUTE_MS },
  "open run inside the grace window → queued",
);

const graceMinutes = BUILD_QUEUED_GRACE_MS / MINUTE_MS;
eq(
  deriveBuildStatus({
    state: null,
    runs: [run({ startedMinutesAgo: graceMinutes + 1 })],
    commits: null,
    nowMs: NOW,
  }),
  { kind: "stalled", sinceMs: NOW - (graceMinutes + 1) * MINUTE_MS },
  "open run past the grace window with no runtime → stalled",
);

eq(
  deriveBuildStatus({
    state: {
      agentRunning: true,
      runtimeObservedAt: at(1),
      currentPromptLabel: null,
      currentPromptStartedAt: null,
    },
    runs: [run({ startedMinutesAgo: 60 })],
    commits: null,
    nowMs: NOW,
  }).kind,
  "building",
  "a fresh runtime observation outranks the open run's age",
);

// ── Idle: the last finished run, and whether it left anything behind ────────
// 2026-09-13: dispatched 22:31, reaped 00:15, repo still at the seed commit.
const reaped = deriveBuildStatus({
  state: null,
  runs: [
    run({
      startedMinutesAgo: 209,
      finishedMinutesAgo: 105,
      outcome: "timeout",
      error: "Timed out — run exceeded maximum duration and was cleaned up",
    }),
  ],
  commits: [{ sha: "12594f7", message: "seed", author: null, atMs: NOW - 210 * MINUTE_MS }],
  nowMs: NOW,
});
eq(
  reaped,
  {
    kind: "idle",
    last: {
      outcome: "timeout",
      startedAtMs: NOW - 209 * MINUTE_MS,
      finishedAtMs: NOW - 105 * MINUTE_MS,
      durationMinutes: 104,
      landed: false,
      shipping: null,
      error: "Timed out — run exceeded maximum duration and was cleaned up",
    },
  },
  "timed-out run with only a pre-run commit → idle, nothing landed",
);

eq(
  deriveBuildStatus({
    state: null,
    runs: [run({ startedMinutesAgo: 50, finishedMinutesAgo: 10, outcome: "timeout" })],
    commits: [{ sha: "abc", message: "feat", author: null, atMs: NOW - 20 * MINUTE_MS }],
    nowMs: NOW,
  }),
  {
    kind: "idle",
    last: {
      outcome: "timeout",
      startedAtMs: NOW - 50 * MINUTE_MS,
      finishedAtMs: NOW - 10 * MINUTE_MS,
      durationMinutes: 40,
      landed: true,
      shipping: null,
      error: null,
    },
  },
  "a commit after the run started counts as landed even on a timeout",
);

eq(
  (
    deriveBuildStatus({
      state: null,
      runs: [
        run({ startedMinutesAgo: 30, finishedMinutesAgo: 5, outcome: "success", commit: "none" }),
      ],
      commits: [],
      nowMs: NOW,
    }) as { last: { landed: boolean } }
  ).last.landed,
  false,
  "summary.commit 'none' is not a commit",
);

eq(
  (
    deriveBuildStatus({
      state: null,
      runs: [
        run({ startedMinutesAgo: 300, finishedMinutesAgo: 250, outcome: "success" }),
        run({ startedMinutesAgo: 60, finishedMinutesAgo: 20, outcome: "error" }),
      ],
      commits: null,
      nowMs: NOW,
    }) as { last: { outcome: string } }
  ).last.outcome,
  "error",
  "the most recently FINISHED run is the last attempt, whatever the input order",
);

eq(
  (
    deriveBuildStatus({
      state: null,
      runs: [run({ startedMinutesAgo: 30, finishedMinutesAgo: 5 })],
      commits: null,
      nowMs: NOW,
    }) as { last: { outcome: string } }
  ).last.outcome,
  "closed",
  "a run without an outcome reports its state",
);

// ── Active: the states in which a second dispatch would double up ───────────
eq(isBuildActive({ kind: "building", sinceMs: null, label: null }), true, "building is active");
eq(isBuildActive({ kind: "queued", sinceMs: NOW }), true, "queued is active");
eq(
  isBuildActive({ kind: "stalled", sinceMs: NOW }),
  false,
  "stalled is not active — safe to start again",
);
eq(isBuildActive({ kind: "idle", last: null }), false, "idle is not active");

// ── Keys: every name a runner might file this project under ─────────────────
eq(
  projectStateKeys({
    name: "one-shot.slop — The One-Shot Slop Machine",
    userProjectName: "one-shot.slop — The One-Shot Slop Machine",
    dirPath: "/home/ubuntu/dev/one-shot.slop-the-one-shot-slop-machine",
    gitUrl: "https://github.com/bitbaum/one-shot.slop-the-one-shot-slop-machine",
  }),
  ["one-shot.slop — the one-shot slop machine", "one-shot.slop-the-one-shot-slop-machine"],
  "display name, directory and repo slug, lower-cased and de-duplicated",
);
eq(
  projectStateKeys({
    name: "Loki",
    dirPath: "/home/g/dev/loki/",
    gitUrl: "git@github.com:bitbaum/loki.git",
  }),
  ["loki"],
  "trailing slash, ssh remote and .git suffix all collapse to one key",
);
eq(projectStateKeys({ name: "  " }), [], "no usable key → empty, not ['']");

if (fail > 0) {
  console.error(`\n${fail} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`✓ project-build-status: ${pass} checks passed`);
