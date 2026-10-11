// Progress updates in the Loki chat (src/lib/loki/progress-update.ts): what the
// team tells the person it works for when work moves.
//
// 2026-10-11, the owner on the feedback inbox and the chat: "a lot of things
// written in big strings that is hard to read and understand … it would be
// helpful if it said what was requested, the likely justification, what was
// done, and what else could be done". These pin that order and that honesty.
import assert from "node:assert/strict";

process.env.AUTH_SECRET ??= "test-secret-for-progress-update";

import {
  buildProgressUpdate,
  progressUpdateText,
  readProgressUpdate,
  UPDATE_SECTIONS,
  UPDATE_STAGE,
} from "../../src/lib/loki/progress-update";
import { buildShippedUpdate } from "../../src/lib/loki/shipped-update";
import { formatRunOutcomeMessage } from "../../src/lib/orchestration/run-outcome-format";
import { feedbackScreenshotPath } from "../../src/lib/loki/update-images";

const note = {
  problem: "Tap targets in the tab bar were 32px.",
  change: "Every tab and button is now at least 48px on touch screens.",
  why: "One shared size, so every control follows the same rule.",
  considered: [{ option: "48px on desktop too", whyNot: "wastes space for a precise pointer." }],
  helps: "Phone visitors.",
  next: "Lazy-load the gallery — left out to keep this change small.",
  where: "The tab bar.",
  plain: "Buttons are bigger now.",
};

// ---- the sections, in order, from the note ----
{
  const u = buildProgressUpdate({
    stage: UPDATE_STAGE.LIVE,
    project: "substrata",
    asked: "the buttons are too small",
    note,
    didLine: "ignored when the note says what changed",
    where: "/",
  });
  assert.equal(u.asked, "the buttons are too small");
  assert.equal(u.problem, note.problem);
  assert.equal(u.done, note.change, "the note's account wins over the handoff line");
  assert.equal(u.why, note.why);
  assert.equal(u.next, note.next);
  assert.equal(u.considered.length, 1);
  assert.match(u.headline, /live on the home page/, 'never "live on /"');
  assert.deepEqual(
    UPDATE_SECTIONS.map((s) => s.key),
    [
      "asked",
      "problem",
      "done",
      "detail",
      "helps",
      "us",
      "downsides",
      "costs",
      "why",
      "next",
      "checks",
    ],
    "asked → wrong → done → helps users → benefits us → downsides → costs → why → next → proof",
  );

  const text = progressUpdateText(u);
  const order = [
    "Asked",
    "What was wrong",
    "What was done",
    "How it helps users",
    "Why this way",
    "Also considered",
    "What could come next",
  ];
  let at = -1;
  for (const label of order) {
    const i = text.indexOf(label);
    assert.ok(i > at, `"${label}" comes after the one before it`);
    at = i;
  }
}

// ---- no note: the handoff fills in, and "nothing" is not a next step ----
{
  const u = buildProgressUpdate({
    stage: UPDATE_STAGE.READY,
    project: "loki",
    didLine: "Renamed the product.",
    summaryNext: "none",
  });
  assert.equal(u.done, "Renamed the product.");
  assert.equal(u.next, null, "a handoff that says 'none' has no next step");
  assert.equal(
    buildProgressUpdate({ stage: "ready", project: "p", summaryNext: "Add the DE copy." }).next,
    "Add the DE copy.",
  );
}

// ---- what a stored message may carry: only our own images and real links ----
{
  const u = buildProgressUpdate({
    stage: UPDATE_STAGE.LIVE,
    project: "p",
    images: [{ src: feedbackScreenshotPath("f1", 0), caption: "Before" }],
    links: [{ label: "Watch", href: "/feedback/f1/watch-fix", primary: true }],
  });
  assert.deepEqual(readProgressUpdate({ update: u }), u, "round-trips through meta");
  const tampered = readProgressUpdate({
    update: {
      ...u,
      images: [{ src: "https://evil.example/x.png", caption: "x" }],
      links: [{ label: "x", href: "javascript:alert(1)" }],
    },
  });
  assert.equal(tampered?.images.length, 0, "an image from elsewhere is dropped");
  assert.equal(tampered?.links.length, 0, "a javascript: link is dropped");
  assert.equal(readProgressUpdate({}), null);
  assert.equal(readProgressUpdate({ update: { v: 2 } }), null, "an unknown version is no update");
}

// ---- "it's live": the walkthrough leads, the before picture comes along ----
{
  const fix = {
    state: "deployed",
    checkedAt: "2026-10-11T00:00:00Z",
    pr: { number: 169, url: "https://github.com/bitbaum/substrata/pull/169", title: "t", note },
    deploy: {
      url: "https://github.com/x/actions/runs/1",
      name: "Deploy",
      conclusion: "success",
      status: "completed",
    },
  } as never;
  const live = buildShippedUpdate({
    announcement: "live",
    projectKey: "substrata",
    feedbackId: "f1",
    asked: "the buttons are too small",
    hasScreenshot: true,
    fix,
    livePageUrl: "https://substrata.orangecat.ch/chat",
    didLine: null,
    summaryNext: null,
  });
  assert.equal(live.stage, UPDATE_STAGE.LIVE);
  assert.equal(live.links[0].label, "Watch the fix");
  assert.ok(live.links[0].primary);
  assert.equal(live.links[0].href, "/feedback/f1/watch-fix");
  assert.ok(live.links.some((l) => l.label === "What changed"));
  assert.equal(live.images[0].src, "/api/feedback/f1/screenshot/0");
  assert.match(live.headline, /live on \/chat/);

  const failed = buildShippedUpdate({
    announcement: "deploy_failed",
    projectKey: "substrata",
    feedbackId: "f1",
    asked: null,
    hasScreenshot: false,
    fix,
    livePageUrl: "https://substrata.orangecat.ch/chat",
    didLine: null,
    summaryNext: null,
  });
  assert.equal(failed.stage, UPDATE_STAGE.DEPLOY_FAILED);
  assert.ok(
    !failed.links.some((l) => l.label === "Watch the fix"),
    "nothing to watch on a failed deploy",
  );
  assert.equal(failed.links[0].label, "The failed deploy");
  assert.match(failed.headline, /Deploy failed after the merge/);
}

// ---- a run that closed at a pull request carries the structured update ----
{
  const m = formatRunOutcomeMessage(
    {
      id: "run-1",
      projectKey: "loki",
      outcome: "success",
      finishedAt: new Date(),
      payload: { conversationId: "c1" },
      summary: {
        done: "Renamed the product; PR opened.",
        next: "",
        tests: "42 passed",
        todos: "",
        health: "",
      },
    } as never,
    {
      evidence: { kind: "pr", url: "https://github.com/bitbaum/loki/pull/700", title: "t" },
      note,
      asked: "rename it",
    },
  );
  assert.ok(m);
  assert.equal(m.meta.update.stage, UPDATE_STAGE.READY);
  assert.equal(m.meta.update.done, note.change);
  assert.equal(m.meta.update.checks, "tests: 42 passed");
  assert.equal(m.meta.update.links[0].label, "What changed");
  assert.match(m.content, /Pull request: /, "the plain text twin is unchanged for older clients");
}

// ---- behind the scenes: explained, proven, no walkthrough to nowhere ----
{
  const behindNote = {
    ...note,
    shows: "behind" as const,
    detail: "The import now retries a timed-out batch up to three times.",
    proof: "A test forces two timeouts; last night's log shows 0 skipped batches.",
  };
  const u = buildShippedUpdate({
    announcement: "live",
    projectKey: "evig",
    feedbackId: "f2",
    asked: "prices were stale",
    hasScreenshot: false,
    fix: {
      state: "deployed",
      checkedAt: "",
      pr: { number: 1, url: "https://github.com/o/r/pull/1", title: "t", note: behindNote },
    } as never,
    livePageUrl: "https://evig.orangecat.ch/shop",
    didLine: null,
    summaryNext: null,
  });
  assert.ok(u.behindTheScenes);
  assert.match(u.headline, /behind the scenes/);
  assert.equal(u.detail, behindNote.detail, "exactly what changed in the system");
  assert.equal(u.checks, behindNote.proof, "the proof is the evidence");
  assert.equal(u.helps, note.helps, "and how it helps users");
  assert.ok(
    !u.links.some((l) => l.label === "Watch the fix"),
    "no walkthrough of a page that did not change",
  );
  assert.ok(u.links.some((l) => l.label === "What changed"));
  const text = progressUpdateText(u);
  assert.ok(text.indexOf("Under the hood") < text.indexOf("How it helps users"));
  assert.ok(text.indexOf("How it helps users") < text.indexOf("Why this way"));
}

// ---- nobody said how it helps users: an honest gap, not a guess ----
{
  const u = buildProgressUpdate({
    stage: UPDATE_STAGE.READY,
    project: "p",
    didLine: "Did a thing.",
  });
  assert.equal(u.helps, null);
  assert.deepEqual(u.missing, ["helps", "us", "downsides", "costs"], "every owed section is named");
  assert.match(progressUpdateText(u), /How it helps users:\*\* Not stated by the developer/);
  assert.match(progressUpdateText(u), /Downsides:\*\* Not stated by the developer/);
  const nothing = buildProgressUpdate({ stage: UPDATE_STAGE.NOT_DONE, project: "p" });
  assert.deepEqual(nothing.missing, [], "a run that did nothing owes nothing");
}

// ---- downsides, costs, benefit to us — and "none" said clearly ----
// The owner, 2026-10-11: "if there are no downsides and no costs, that should
// be very clearly shown."
{
  const u = buildProgressUpdate({
    stage: UPDATE_STAGE.LIVE,
    project: "p",
    note: {
      ...note,
      us: "Fewer support emails about stale prices.",
      downsides: "None",
      costs: "None",
    },
  });
  assert.equal(u.us, "Fewer support emails about stale prices.");
  assert.equal(u.downsides, "None");
  assert.deepEqual(u.missing, []);
  const text = progressUpdateText(u);
  assert.match(text, /Downsides:\*\* None ✓/);
  assert.match(text, /Costs:\*\* None ✓/);
  assert.ok(text.indexOf("How it helps users") < text.indexOf("How it benefits us"));
  assert.ok(text.indexOf("How it benefits us") < text.indexOf("Downsides"));

  const real = buildProgressUpdate({
    stage: UPDATE_STAGE.READY,
    project: "p",
    note: {
      ...note,
      us: "u",
      downsides: "The import takes up to 3 minutes longer on a bad night.",
      costs: "None",
    },
  });
  assert.match(progressUpdateText(real), /Downsides:\*\* The import takes up to 3 minutes longer/);
}

console.log("progress-update: ok");
