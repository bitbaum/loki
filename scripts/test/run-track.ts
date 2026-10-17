/**
 * The delivery track (lib/run-track): asked → builder → working → pull
 * request → merged → live, from run facts only.
 *
 * What has to stay true: a stage is done only on evidence (an event, a URL
 * on GitHub, a deploy), the one sentence names the furthest point reached,
 * and "settled" is true exactly when nothing will move any more — the page
 * polls until then and not a second longer.
 *
 * Run: npx tsx scripts/test/run-track.ts
 */
import assert from "node:assert/strict";
import { buildRunTrack, type RunTrackInput } from "@/lib/run-track";
import { FIX_SHIP_STATE } from "@/lib/feedback/fix-shipping";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

const base: RunTrackInput = {
  eventKinds: ["dispatched"],
  run: { finishedAt: null, outcome: null },
  phase: "queued",
  stalled: false,
  needsYou: null,
  evidence: null,
  fix: null,
  liveUrl: "https://petvity.orangecat.ch",
  providerLabel: "Claude Code",
  failure: null,
};
const PR = "https://github.com/bitbaum/petvity/pull/113";
const states = (i: RunTrackInput) =>
  buildRunTrack(i)
    .stages.map((s) => s.state)
    .join(" ");

check("queued: nothing is claimed as done but the ask", () => {
  const t = buildRunTrack(base);
  assert.equal(states(base), "done now next next next next");
  assert.match(t.summary, /Waiting for a builder/);
  assert.equal(t.settled, false);
  assert.equal(t.current, "builder");
});

check("claimed and generating: the builder stage is done on the event, not on time", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "launched", "submitted", "generating"],
    phase: "working",
  };
  assert.equal(states(i), "done done now next next next");
  assert.match(buildRunTrack(i).summary, /Claude Code is making the change/);
});

check("a pull request seen on GitHub while the run is live is a done stage with a link", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "generating", "progress"],
    phase: "working",
    evidence: { kind: "pr", url: PR, title: "fix(home): 14px" },
  };
  const t = buildRunTrack(i);
  assert.equal(states(i), "done done done done next next");
  const pr = t.stages.find((s) => s.id === "pr")!;
  assert.equal(pr.href, PR);
  assert.equal(pr.note, "fix(home): 14px");
  assert.match(t.summary, /Pull request open — Claude Code is finishing up/);
  assert.equal(t.settled, false);
});

check("blocked: the working stage asks for the person, in the warning state", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "submitted", "blocked"],
    phase: "stuck",
    needsYou: "It is waiting at a login prompt.",
  };
  const t = buildRunTrack(i);
  assert.equal(t.stages[2].state, "attention");
  assert.equal(t.summary, "It is waiting at a login prompt.");
});

check("stalled while working reads as quiet, never as working", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "generating"],
    phase: "stuck",
    stalled: true,
  };
  assert.equal(buildRunTrack(i).stages[2].state, "attention");
  assert.match(buildRunTrack(i).stages[2].label, /went quiet/);
});

check("finished well, ledger not read yet: the page keeps looking, nothing is claimed", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "generating", "handoff", "closed"],
    phase: "needs_verify",
    run: { finishedAt: "2026-10-17T10:05:00Z", outcome: "success" },
  };
  const t = buildRunTrack(i);
  assert.equal(states(i), "done done done now next next");
  assert.match(t.summary, /checking where the change is/);
  assert.equal(t.settled, false);
});

check("finished with no evidence at all is a failed stage and a settled track", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "generating", "handoff", "closed"],
    phase: "needs_verify",
    run: { finishedAt: "2026-10-17T10:05:00Z", outcome: "success" },
    fix: { state: FIX_SHIP_STATE.NO_EVIDENCE, prUrl: null, liveUrl: null, looked: null },
  };
  const t = buildRunTrack(i);
  assert.equal(t.stages[3].state, "failed");
  assert.match(t.summary, /nothing reached GitHub/);
  assert.equal(t.settled, true);
});

check("pull request open after the run: checks are 'now', live is next, not settled", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "generating", "handoff", "closed"],
    phase: "needs_verify",
    run: { finishedAt: "2026-10-17T10:05:00Z", outcome: "success" },
    fix: { state: FIX_SHIP_STATE.PR_OPEN, prUrl: PR, liveUrl: null, looked: null },
  };
  const t = buildRunTrack(i);
  assert.equal(states(i), "done done done done now next");
  assert.match(t.summary, /merges and deploys by itself/);
  assert.equal(t.settled, false);
});

check("merged: deploying is now and names the site", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "generating", "handoff", "closed"],
    phase: "needs_verify",
    run: { finishedAt: "2026-10-17T10:05:00Z", outcome: "success" },
    fix: { state: FIX_SHIP_STATE.MERGED, prUrl: PR, liveUrl: null, looked: null },
  };
  const t = buildRunTrack(i);
  assert.equal(states(i), "done done done done done now");
  assert.match(t.stages[5].note ?? "", /petvity\.orangecat\.ch/);
  assert.match(t.summary, /deploying to petvity\.orangecat\.ch/);
});

check("deployed but not yet looked at: live is done, still not settled", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "generating", "handoff", "closed"],
    phase: "done",
    run: { finishedAt: "2026-10-17T10:05:00Z", outcome: "success" },
    fix: {
      state: FIX_SHIP_STATE.DEPLOYED,
      prUrl: PR,
      liveUrl: "https://petvity.orangecat.ch",
      looked: null,
    },
  };
  const t = buildRunTrack(i);
  assert.equal(states(i), "done done done done done done");
  assert.equal(t.stages[5].href, "https://petvity.orangecat.ch");
  assert.equal(t.stages[5].linkLabel, "Open the live page");
  assert.equal(t.summary, "Live on petvity.orangecat.ch.");
  assert.equal(t.settled, false, "Loki has not looked yet — keep asking");
});

check("deployed and looked at: the verdict is in the sentence and the track settles", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "generating", "handoff", "closed"],
    phase: "done",
    run: { finishedAt: "2026-10-17T10:05:00Z", outcome: "success" },
    fix: {
      state: FIX_SHIP_STATE.DEPLOYED,
      prUrl: PR,
      liveUrl: "https://petvity.orangecat.ch",
      looked: { verdict: "looks_fixed" },
    },
  };
  const t = buildRunTrack(i);
  assert.match(t.summary, /the change shows/);
  assert.equal(t.settled, true);
  assert.equal(t.current, "live");
});

check("deployed with no live page to read settles at once", () => {
  const i: RunTrackInput = {
    ...base,
    liveUrl: null,
    eventKinds: ["dispatched", "claimed", "generating", "handoff", "closed"],
    phase: "done",
    run: { finishedAt: "2026-10-17T10:05:00Z", outcome: "success" },
    fix: { state: FIX_SHIP_STATE.DEPLOYED, prUrl: PR, liveUrl: null, looked: null },
  };
  const t = buildRunTrack(i);
  assert.equal(t.summary, "Live on the site.");
  assert.equal(t.settled, true);
});

check("a failed run names the reason on the working stage and settles", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "submitted", "closed"],
    phase: "failed",
    run: { finishedAt: "2026-10-17T10:05:00Z", outcome: "timeout" },
    failure: "Claude Code stopped before it finished.",
  };
  const t = buildRunTrack(i);
  assert.equal(states(i), "done done failed next next next");
  assert.equal(t.stages[2].note, null, "the reason is the headline, not said twice");
  assert.equal(t.summary, "Claude Code stopped before it finished.");
  assert.equal(t.settled, true);
  assert.equal(t.current, "working");
});

check("a run that ended before any builder claimed it fails at the builder stage", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "closed"],
    phase: "failed",
    run: { finishedAt: "2026-10-17T10:05:00Z", outcome: "undelivered" },
    failure: "No builder was online.",
  };
  const t = buildRunTrack(i);
  assert.equal(t.stages[1].state, "failed");
  assert.equal(t.summary, "No builder was online.");
});

check("closed pull request fails the merge stage and settles", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "generating", "handoff", "closed"],
    phase: "needs_verify",
    run: { finishedAt: "2026-10-17T10:05:00Z", outcome: "success" },
    fix: { state: FIX_SHIP_STATE.PR_CLOSED, prUrl: PR, liveUrl: null, looked: null },
  };
  const t = buildRunTrack(i);
  assert.equal(t.stages[4].state, "failed");
  assert.equal(t.settled, true);
});

check("pushed without a pull request: honest, and the person is told it cannot ship itself", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "generating", "handoff", "closed"],
    phase: "needs_verify",
    run: { finishedAt: "2026-10-17T10:05:00Z", outcome: "success" },
    evidence: { kind: "push", url: "https://github.com/o/r/tree/fix", title: "push to fix" },
    fix: { state: FIX_SHIP_STATE.PUSHED, prUrl: null, liveUrl: null, looked: null },
  };
  const t = buildRunTrack(i);
  assert.equal(t.stages[3].state, "attention");
  assert.equal(t.stages[3].linkLabel, "See the branch");
  assert.match(t.summary, /cannot ship by itself/);
  assert.equal(t.settled, true);
});

console.log(`\n✓ run-track: ${passed} passed`);
