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
import {
  buildRunTrack,
  formatStageSeconds,
  stageTimings,
  PR_LOOK_WINDOW_MS,
  type RunTrackInput,
} from "@/lib/run-track";
import { FIX_SHIP_STATE } from "@/lib/feedback/fix-shipping";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

const base: RunTrackInput = {
  eventKinds: ["dispatched"],
  eventTimes: { dispatched: "2026-10-17T09:52:00Z" },
  run: { startedAt: "2026-10-17T09:52:00Z", finishedAt: null, outcome: null },
  askedAt: "2026-10-17T09:52:00Z",
  phase: "queued",
  stalled: false,
  lastProgressAt: null,
  needsYou: null,
  builderLabel: null,
  evidence: null,
  fix: null,
  liveUrl: "https://petvity.orangecat.ch",
  providerLabel: "Claude Code",
  failure: null,
};
const PR = "https://github.com/bitbaum/petvity/pull/113";
const ledger = (
  state: RunTrackInput["fix"] extends infer F ? (F extends { state: infer S } ? S : never) : never,
  over: Partial<NonNullable<RunTrackInput["fix"]>> = {},
): NonNullable<RunTrackInput["fix"]> => ({
  state,
  prUrl: null,
  prTitle: null,
  prNumber: null,
  mergedAt: null,
  deploy: null,
  liveUrl: null,
  looked: null,
  ...over,
});
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
    eventTimes: {
      dispatched: "2026-10-17T09:52:00Z",
      claimed: "2026-10-17T09:52:30Z",
      generating: "2026-10-17T09:53:00Z",
    },
    evidence: {
      kind: "pr",
      url: PR,
      title: "fix(home): 14px",
      atMs: Date.parse("2026-10-17T09:58:02Z"),
    },
  };
  const t = buildRunTrack(i);
  assert.equal(states(i), "done done now done next next", "still in the session: finishing up");
  assert.match(t.stages[2].label, /finishing up/);
  assert.equal(t.stages[1].at, "2026-10-17T09:52:30Z", "the builder stage is dated by its event");
  assert.equal(t.stages[3].at, "2026-10-17T09:58:02.000Z", "the PR stage is dated by GitHub");
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
    // Just finished: inside PR_LOOK_WINDOW_MS, so still looking.
    now: Date.parse("2026-10-17T10:10:00Z"),
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
    fix: ledger(FIX_SHIP_STATE.NO_EVIDENCE),
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
    fix: ledger(FIX_SHIP_STATE.PR_OPEN, { prUrl: PR, prTitle: "fix(home): 14px", prNumber: 113 }),
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
    fix: ledger(FIX_SHIP_STATE.MERGED, { prUrl: PR, mergedAt: "2026-10-17T09:59:27Z" }),
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
    fix: ledger(FIX_SHIP_STATE.DEPLOYED, {
      prUrl: PR,
      mergedAt: "2026-10-17T09:59:27Z",
      deploy: { name: "Deploy", url: "https://github.com/x/runs/1", at: "2026-10-17T10:03:16Z" },
      liveUrl: "https://petvity.orangecat.ch",
    }),
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
    fix: ledger(FIX_SHIP_STATE.DEPLOYED, {
      prUrl: PR,
      liveUrl: "https://petvity.orangecat.ch",
      looked: {
        verdict: "looks_fixed",
        evidence: "The labels read 14px.",
        at: "2026-10-17T10:05:00Z",
      },
    }),
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
    fix: ledger(FIX_SHIP_STATE.DEPLOYED, { prUrl: PR }),
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
  assert.equal(t.stages[2].label, "Claude Code stopped", "it was delivered, so it did start");
});

check("an agent that never opened could not start — it did not stop", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "closed"],
    phase: "failed",
    run: { finishedAt: "2026-10-17T10:05:00Z", outcome: "failed" },
    failure: "Grok is not installed on the cloud builder, so nothing was started.",
  };
  const t = buildRunTrack(i);
  assert.equal(states(i), "done done failed next next next");
  assert.equal(t.stages[2].label, "Claude Code could not start");
  assert.equal(t.summary, "Grok is not installed on the cloud builder, so nothing was started.");
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
    fix: ledger(FIX_SHIP_STATE.PR_CLOSED, { prUrl: PR }),
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
    fix: ledger(FIX_SHIP_STATE.PUSHED),
  };
  const t = buildRunTrack(i);
  assert.equal(t.stages[3].state, "attention");
  assert.equal(t.stages[3].linkLabel, "See the branch");
  assert.match(t.summary, /cannot ship by itself/);
  assert.equal(t.settled, true);
});

check("timings: took between dated stages, a clock on the current one, nothing for the ask", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "generating"],
    eventTimes: {
      dispatched: "2026-10-17T09:52:00Z",
      claimed: "2026-10-17T09:52:40Z",
      generating: "2026-10-17T09:53:10Z",
    },
    phase: "working",
    builderLabel: "the cloud builder",
  };
  const t = buildRunTrack(i);
  const now = Date.parse("2026-10-17T09:55:10Z");
  const timing = stageTimings(t.stages, now);
  assert.equal(timing[0].took, null, "the ask has no 'took'");
  assert.equal(timing[1].took, 40, "builder: 40s after the ask");
  assert.equal(timing[2].soFar, 120, "working for two minutes so far");
  assert.equal(timing[3].took, null);
  assert.equal(t.stages[1].label, "The cloud builder picked it up");
  assert.ok(t.stages[1].facts.some((f) => f.text.includes("claimed the job")));
});

check("timings after live: merged took from the PR, live from the merge", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "generating", "handoff", "closed"],
    eventTimes: { claimed: "2026-10-17T09:52:30Z", handoff: "2026-10-17T09:58:30Z" },
    phase: "done",
    run: {
      startedAt: "2026-10-17T09:52:00Z",
      finishedAt: "2026-10-17T09:58:40Z",
      outcome: "success",
    },
    evidence: { kind: "pr", url: PR, title: "t", atMs: Date.parse("2026-10-17T09:58:02Z") },
    fix: ledger(FIX_SHIP_STATE.DEPLOYED, {
      prUrl: PR,
      mergedAt: "2026-10-17T09:59:27Z",
      deploy: { name: "Deploy", url: null, at: "2026-10-17T10:03:16Z" },
      liveUrl: "https://petvity.orangecat.ch",
      looked: { verdict: "looks_fixed", evidence: "shows", at: "2026-10-17T10:05:00Z" },
    }),
  };
  const timing = stageTimings(buildRunTrack(i).stages, Date.parse("2026-10-17T10:10:00Z"));
  assert.equal(timing[4].took, 85, "merged 1m 25s after the PR opened");
  assert.equal(timing[5].took, 229, "live 3m 49s after the merge");
  assert.equal(timing[5].soFar, null, "a done stage has no clock");
});

check("formatStageSeconds reads like a stopwatch", () => {
  assert.equal(formatStageSeconds(48), "48s");
  assert.equal(formatStageSeconds(80), "1m 20s");
  assert.equal(formatStageSeconds(3780), "1h 03m");
});

check("what the repository shows rides on the track: commits as facts, checks as a stage", () => {
  const live: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "generating", "progress"],
    phase: "working",
    repo: {
      commits: [
        { sha: "a", message: "fix: one", at: "2026-10-17T09:55:00Z", url: "u/a" },
        { sha: "b", message: "fix: two", at: "2026-10-17T09:56:00Z", url: "u/b" },
        { sha: "c", message: "fix(home): three", at: "2026-10-17T09:57:00Z", url: "u/c" },
        { sha: "d", message: "fix: four", at: "2026-10-17T09:58:00Z", url: "u/d" },
      ],
      pr: {
        number: 113,
        title: "fix(home): 14px",
        url: PR,
        at: "2026-10-17T09:58:02Z",
        checks: "running",
      },
    },
  };
  const t = buildRunTrack(live);
  assert.equal(states(live), "done done now done now next", "PR from the repo; checks running");
  const work = t.stages.find((s) => s.id === "working")!;
  const pushed = work.facts.filter((f) => f.text.startsWith("Pushed"));
  assert.equal(pushed.length, 4, "three newest commits and one line for the rest");
  assert.equal(pushed[0].text, "Pushed 1 earlier commit.");
  assert.equal(pushed[3].text, "Pushed: Four");
  assert.equal(pushed[3].href, "u/d");
  const pr = t.stages.find((s) => s.id === "pr")!;
  assert.equal(pr.note, "#113 · fix(home): 14px");
  assert.equal(pr.at, "2026-10-17T09:58:02Z", "dated by the repository");
  assert.match(t.stages.find((s) => s.id === "merged")!.label, /Checks running/);

  const red = buildRunTrack({
    ...live,
    repo: { ...live.repo!, pr: { ...live.repo!.pr!, checks: "failed" } },
  });
  assert.equal(
    red.stages.find((s) => s.id === "merged")!.state,
    "attention",
    "a red check needs eyes",
  );
  assert.match(red.summary, /A check failed on the pull request — Claude Code usually fixes it/);

  const green = buildRunTrack({
    ...live,
    run: { ...live.run, finishedAt: "2026-10-17T10:00:00Z", outcome: "success" },
    phase: "done",
    repo: { ...live.repo!, pr: { ...live.repo!.pr!, checks: "passed" } },
  });
  assert.match(green.stages.find((s) => s.id === "merged")!.label, /Checks passed — merging/);
  assert.equal(green.settled, false, "merging is still movement");

  const branchOnly: RunTrackInput = { ...live, repo: { ...live.repo!, pr: null } };
  assert.equal(states(branchOnly), "done done now now next next", "commits with no PR = pushed");
  assert.match(
    buildRunTrack(branchOnly).summary,
    /Pushed to a branch — a pull request usually follows/,
  );
});

check("a run that finished well was picked up, even with no claim on record", () => {
  // The live demo's seeded run: no claimed/launched events, closed with
  // success. The card read "No builder picked it up" above "finished".
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "handoff"],
    run: {
      startedAt: "2026-10-14T04:20:00Z",
      finishedAt: "2026-10-14T04:49:00Z",
      outcome: "success",
    },
    phase: "done",
    builderLabel: "the cloud builder",
  };
  const t = buildRunTrack(i);
  assert.equal(t.stages[1].state, "done");
  assert.equal(
    t.stages[1].label,
    "The cloud builder picked it up",
    "a label starts with a capital",
  );
  assert.ok(!t.stages.some((s) => s.state === "failed"), "no stage contradicts the finish");
});

check("past the follow window nothing waits forever: no stage is 'now', the track settles", () => {
  const old: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "generating", "handoff"],
    run: {
      startedAt: "2026-10-14T04:20:00Z",
      finishedAt: "2026-10-14T04:49:00Z",
      outcome: "success",
    },
    phase: "done",
    followable: false,
  };
  const t = buildRunTrack(old);
  assert.ok(!t.stages.some((s) => s.state === "now"), states(old));
  assert.equal(t.stages.find((s) => s.id === "pr")!.at, null, "no clock on a stage nobody follows");
  assert.match(t.stages.find((s) => s.id === "pr")!.note!, /two days/);
  assert.equal(
    t.stages.find((s) => s.id === "pr")!.label,
    "No pull request on record",
    "a stage nobody follows does not say it is looking",
  );
  assert.equal(t.settled, true, "the page stops asking");
  assert.match(t.summary, /^Claude Code finished — this ran more than two days ago/);

  const prOpen = buildRunTrack({ ...old, fix: ledger(FIX_SHIP_STATE.PR_OPEN, { prUrl: PR }) });
  assert.equal(prOpen.stages.find((s) => s.id === "pr")!.state, "done", "what is on record stays");
  assert.equal(prOpen.stages.find((s) => s.id === "merged")!.state, "next");
  assert.equal(prOpen.stages.find((s) => s.id === "merged")!.label, "Merge not on record");
  assert.match(prOpen.summary, /^Pull request opened — this ran more than two days ago/);
  assert.equal(prOpen.settled, true);

  const live = buildRunTrack({ ...old, fix: ledger(FIX_SHIP_STATE.DEPLOYED, { prUrl: PR }) });
  assert.match(
    live.summary,
    /^Live on petvity\.orangecat\.ch/,
    "a finished story is told as it was",
  );

  // Just finished (inside PR_LOOK_WINDOW_MS as well as the follow window).
  const recent = buildRunTrack({
    ...old,
    followable: true,
    now: Date.parse("2026-10-14T04:55:00Z"),
  });
  assert.equal(
    recent.stages.find((s) => s.id === "pr")!.state,
    "now",
    "inside the window it looks",
  );
});

// Inside the two days Loki follows a run, but past half an hour with nothing
// on GitHub: "Looking for the pull request" with a clock was no longer true
// (owner's walk-through of the demo, 2026-10-17).
check("followed, finished, no pull request after the look window: said plainly, settled", () => {
  const fin = Date.parse("2026-10-15T19:13:00Z");
  const run = {
    startedAt: "2026-10-15T18:44:00Z",
    finishedAt: "2026-10-15T19:13:00Z",
    outcome: "success",
  };
  const early = buildRunTrack({ ...base, run, phase: "done", now: fin + 5 * 60_000 });
  assert.equal(early.stages.find((s) => s.id === "pr")!.label, "Looking for the pull request");
  assert.equal(early.settled, false, "inside the window it is still looking");
  const t = buildRunTrack({ ...base, run, phase: "done", now: fin + PR_LOOK_WINDOW_MS + 60_000 });
  const pr = t.stages.find((s) => s.id === "pr")!;
  assert.equal(pr.label, "No pull request found");
  assert.equal(pr.state, "attention");
  assert.equal(pr.at, null, "no clock on a stage that will not move");
  assert.equal(t.settled, true);
  assert.match(t.summary, /no pull request was found/);
  assert.ok(!t.stages.some((s) => s.state === "failed"), "nothing contradicts it");
});

check("a found pull request is never overridden by the look window", () => {
  const fin = Date.parse("2026-10-15T19:13:00Z");
  const t = buildRunTrack({
    ...base,
    run: {
      startedAt: "2026-10-15T18:44:00Z",
      finishedAt: "2026-10-15T19:13:00Z",
      outcome: "success",
    },
    phase: "done",
    evidence: { kind: "pr", url: PR, title: "Fix", atMs: fin - 60_000 },
    now: fin + 10 * PR_LOOK_WINDOW_MS,
  });
  assert.equal(t.stages.find((s) => s.id === "pr")!.label, "Pull request opened");
});

check("past the follow window, main's 'not on record' wording wins over the look window", () => {
  const fin = Date.parse("2026-10-10T19:13:00Z");
  const t = buildRunTrack({
    ...base,
    run: {
      startedAt: "2026-10-10T18:44:00Z",
      finishedAt: "2026-10-10T19:13:00Z",
      outcome: "success",
    },
    phase: "done",
    followable: false,
    now: fin + 7 * 24 * 3600_000,
  });
  assert.equal(t.stages.find((s) => s.id === "pr")!.label, "No pull request on record");
});

check("a preview that finished well is live, not 'nothing reached GitHub'", () => {
  const i: RunTrackInput = {
    ...base,
    eventKinds: ["dispatched", "claimed", "delivered", "completed"],
    run: {
      startedAt: "2026-10-18T16:34:00Z",
      finishedAt: "2026-10-18T16:57:00Z",
      outcome: "success",
    },
    phase: "done",
    fix: ledger(FIX_SHIP_STATE.NO_EVIDENCE),
    liveUrl: "https://centersom.orangecat.ch/",
    savedLive: true,
  };
  const t = buildRunTrack(i);
  assert.deepEqual(
    t.stages.map((s) => s.id),
    ["asked", "builder", "working", "live"],
    "no pull request, merge or deploy stage for a preview",
  );
  assert.equal(t.stages.at(-1)!.state, "done");
  assert.equal(t.stages.at(-1)!.label, "Live on centersom.orangecat.ch");
  assert.ok(!t.stages.some((s) => s.state === "failed"));
  assert.match(t.summary, /^Live on centersom\.orangecat\.ch/);
  assert.equal(t.settled, true);
  assert.equal(t.current, "live");
});

check("a preview still being built is not live yet and keeps being followed", () => {
  const t = buildRunTrack({ ...base, liveUrl: "https://centersom.orangecat.ch/", savedLive: true });
  assert.equal(t.stages.at(-1)!.state, "next");
  assert.equal(t.settled, false);
});

console.log(`\n✓ run-track: ${passed} passed`);
