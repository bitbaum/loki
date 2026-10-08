// "Watch the fix": the walkthrough ticket, its script, and the failure line.
//
// 2026-09-28: the owner tapped a green "Live · confirm" chip expecting to watch
// the work and landed on the site's homepage with no idea where to look; a
// failed Petvity run said only "Retry" above a Retry button. These pin the
// pieces that replaced both.
import assert from "node:assert/strict";

import {
  createShareToken,
  createTourToken,
  sharedWatchPath,
  verifyShareToken,
  verifyTourToken,
  tourSiteUrl,
  TOUR_HASH_KEY,
} from "../../src/lib/feedback/tour-token";
import {
  buildTourBeats,
  fallbackTourSteps,
  parseTourSteps,
  tourOutro,
  tourPrompt,
  TOUR_CHAPTER,
} from "../../src/lib/feedback/tour-plan";
import { explainRunFailure } from "../../src/lib/feedback/failure-reason";
import { bottomBarInset, readMs } from "../../widget/tour";

// Read at call time, so setting it after the imports is enough.
process.env.AUTH_SECRET ??= "test-secret-for-tour-token";

// ---- ticket ----
{
  const id = "3f0c7a52-1111-4222-8333-944455556666";
  const now = Date.now();
  const token = createTourToken(id, now);
  assert.deepEqual(verifyTourToken(token, now), { feedbackId: id, audience: "owner" });
  assert.equal(verifyTourToken(token, now + 25 * 60 * 60 * 1000), null, "expires within a day");
  assert.equal(verifyTourToken(`${token}x`, now), null, "a tampered signature is refused");
  const [, exp, sig] = token.split(".");
  assert.equal(verifyTourToken(`other-id.${exp}.${sig}`, now), null, "bound to its feedback id");
  const url = tourSiteUrl("https://farmhouse.orangecat.ch/#old", token);
  assert.ok(
    url.startsWith(`https://farmhouse.orangecat.ch/#${TOUR_HASH_KEY}=`),
    "rides the fragment",
  );
  assert.ok(!url.includes("#old"), "the page's own fragment is replaced, not doubled");

  // The reporter's ticket: a week, its own audience, and no way to become the owner's.
  const forReporter = createTourToken(id, now, "reporter");
  assert.deepEqual(verifyTourToken(forReporter, now + 6 * 24 * 60 * 60 * 1000), {
    feedbackId: id,
    audience: "reporter",
  });
  assert.equal(verifyTourToken(forReporter, now + 8 * 24 * 60 * 60 * 1000), null);
  const [rid, rexp, , rsig] = forReporter.split(".");
  assert.equal(
    verifyTourToken(`${rid}.${rexp}.${rsig}`, now),
    null,
    "dropping the mark is refused",
  );
  assert.equal(verifyTourToken(`${id}.${exp}.r.${sig}`, now), null, "adding the mark is refused");

  // The viewer's ticket (minted by a share link): its own audience, unpromotable.
  const forViewer = createTourToken(id, now, "viewer");
  assert.deepEqual(verifyTourToken(forViewer, now), { feedbackId: id, audience: "viewer" });
  const [vid, vexp, , vsig] = forViewer.split(".");
  assert.equal(verifyTourToken(`${vid}.${vexp}.${vsig}`, now), null, "viewer → owner refused");
  assert.equal(verifyTourToken(`${vid}.${vexp}.r.${vsig}`, now), null, "viewer → reporter refused");
  assert.equal(
    verifyTourToken(`${vid}.${vexp}.x.${vsig}`, now),
    null,
    "an unknown mark is refused",
  );

  // The share token: long-lived, and never interchangeable with a tour ticket.
  const share = createShareToken(id, now);
  assert.deepEqual(verifyShareToken(share, now + 60 * 24 * 60 * 60 * 1000), { feedbackId: id });
  assert.equal(verifyShareToken(share, now + 91 * 24 * 60 * 60 * 1000), null, "it does expire");
  assert.equal(verifyTourToken(share, now), null, "a share link is not a walkthrough ticket");
  assert.equal(verifyShareToken(token, now), null, "an owner ticket is not a share link");
  assert.equal(verifyShareToken(`${share}x`, now), null, "tampering is refused");
  assert.ok(sharedWatchPath(share).startsWith("/w/"));
  assert.equal(
    verifyTourToken(`${rid}.${rexp}.x.${rsig}`, now),
    null,
    "an unknown mark is refused",
  );
}

// ---- script ----
const outline = [
  { i: 0, tag: "h1", text: "Farmhouse" },
  { i: 1, tag: "a", text: "About → #about" },
  { i: 2, tag: "footer", text: "© Farmhouse" },
  { i: 3, tag: "a", text: "Back to top → #top" },
];
{
  const steps = parseTourSteps(
    'Sure! {"steps":[{"target":3,"action":"point","say":"Down here — the new Back to top link."},' +
      '{"target":3,"action":"click","say":"Tapping it takes you up."},' +
      '{"target":null,"action":"scroll","say":"And we are back at the menu."},' +
      '{"target":99,"action":"point","say":"Invented"},{"target":null,"action":"point","say":"Nowhere"}]}',
    outline.length,
  );
  assert.equal(steps.length, 3, "out-of-range and targetless non-scroll steps are dropped");
  assert.equal(steps[1].action, "click");
  assert.equal(steps[2].target, null);
  assert.deepEqual(parseTourSteps("not json", 4), []);
  assert.deepEqual(
    parseTourSteps('{"steps":[{"target":null,"action":"scroll","say":"Up"}]}', 4),
    [],
    "a walkthrough that points at nothing is no walkthrough",
  );
}
{
  const input = {
    suggestion:
      'At the very bottom of the page, add a small "Back to top" link so people on phones can get back to the menu quickly.',
    didLine: null,
    prTitle: "Add back-to-top link to footer",
    selectors: [],
    outline,
  };
  const steps = fallbackTourSteps(input);
  assert.ok(
    steps.some((s) => s.target === 3),
    "no model: finds the element by the report's words",
  );
  assert.ok(
    tourPrompt(input).includes("3. <a> Back to top → #top"),
    "the model sees numbered rows",
  );
  const picked = fallbackTourSteps({ ...input, selectors: ["footer > a.top"] });
  assert.equal(picked[0].selector, "footer > a.top", "a picked element outranks guessing");
}

// ---- failure line ----
{
  for (const error of [
    null,
    "",
    "some unknown thing",
    "You've hit your usage limit",
    "Timed out — run exceeded maximum duration and was cleaned up",
    "fatal: could not read from remote repository",
  ]) {
    const line = explainRunFailure(error);
    assert.notEqual(line, "Retry", "never the bare word above a Retry button");
    assert.ok(line.length > 20, `a sentence for ${JSON.stringify(error)}`);
  }
  assert.match(explainRunFailure("429 Too Many Requests"), /quota/);
  assert.match(explainRunFailure("fatal: could not read from remote repository"), /repository/);
  assert.match(explainRunFailure("inject failed: tab not found"), /session/);
  // The agent opened and took the prompt: "check the builder is online" is the
  // wrong next move, and the row must say the agent was the one that went quiet.
  const silent = explainRunFailure(
    "Dispatch failed before the prompt reached the agent: launched claude (pty) + injected, but Loki could not verify generation. claude opened on this computer, but produced no response after Loki submitted the prompt.",
  );
  assert.match(silent, /never answered/);
  assert.doesNotMatch(silent, /builder is online/);
}

// ---- the story: chapters for the owner, plain words for the reporter ----
// 2026-10-07: the owner watched a fix and asked for the walkthrough to show
// "how the problem was solved, why so, what the alternatives were, how it
// benefits users". The reporter gets the same change without the reasoning.
{
  const note = {
    problem: "The menu link pointed at an anchor that no longer existed.",
    change: "The footer now has a Back to top link.",
    why: "A footer link is where people look after reading to the end.",
    considered: [{ option: "A floating button", whyNot: "it covered the chat widget" }],
    helps: "Anyone on a phone at the bottom of a long page.",
    where: "The footer.",
    plain: "There is now a link at the bottom that takes you straight back up.",
  };
  const story = {
    asked: "Add a back to top link",
    note,
    didLine: "Added the link.",
    steps: [{ target: 3, action: "click" as const, say: "Down here — tap it." }],
    before: "data:image/png;base64,AAAA",
  };
  const owner = buildTourBeats({ ...story, audience: "owner" });
  const chapters = owner.map((b) => b.chapter);
  for (const c of [
    TOUR_CHAPTER.ASKED,
    TOUR_CHAPTER.PROBLEM,
    TOUR_CHAPTER.CHANGE,
    TOUR_CHAPTER.WHY,
    TOUR_CHAPTER.CONSIDERED,
    TOUR_CHAPTER.HELPS,
  ])
    assert.ok(chapters.includes(c), `owner story has "${c}"`);
  assert.ok(
    chapters.indexOf(TOUR_CHAPTER.CHANGE) < chapters.indexOf(TOUR_CHAPTER.WHY),
    "show the change before arguing for it",
  );
  assert.equal(owner[0].image, story.before, "the report opens with what it looked like");
  assert.ok(
    owner.some((b) => b.target === 3 && b.action === "click"),
    "the live demo is in it",
  );
  assert.match(owner.find((b) => b.chapter === TOUR_CHAPTER.CONSIDERED)?.say ?? "", /not chosen/);

  const reporter = buildTourBeats({ ...story, audience: "reporter" });
  const said = reporter.map((b) => b.say).join(" ");
  for (const internal of [note.problem, note.why, note.helps, note.change, "floating button"])
    assert.ok(!said.includes(internal), `the reporter is not told: ${internal}`);
  assert.ok(said.includes(note.plain), "the reporter gets the plain sentence");
  assert.ok(
    reporter.some((b) => b.target === 3),
    "and the same live demonstration",
  );
  assert.doesNotMatch(tourOutro("reporter"), /Added the link/);

  // Someone the owner shared it with: the live change and its plain sentence —
  // no maintainer's reasoning, and nothing of the reporter's: not their
  // screenshot, not even their words (the first shared link quoted a
  // request's typos and the owner's private ambition, 2026-10-08).
  const viewer = buildTourBeats({ ...story, audience: "viewer" });
  const told = viewer.map((b) => b.say).join(" ");
  for (const internal of [note.problem, note.why, note.change, "floating button", story.asked])
    assert.ok(!told.includes(internal), `a viewer is not told: ${internal}`);
  assert.equal(viewer[0].chapter, TOUR_CHAPTER.REQUEST);
  assert.doesNotMatch(told, /You asked|You reported/, "never 'you' to someone who didn't ask");
  assert.ok(
    viewer.every((b) => !b.image),
    "no screenshot",
  );
  assert.ok(
    viewer.some((b) => b.target === 3),
    "the same live demonstration",
  );

  // The end card asks; it does not replay the agent's change log (2026-10-08).
  for (const a of ["owner", "reporter", "viewer"] as const)
    assert.ok(tourOutro(a).length < 110, `${a} outro is one short line`);

  // No note (a PR from before it was asked for): the owner still gets a story.
  const bare = buildTourBeats({ ...story, note: null, before: null, audience: "owner" });
  assert.deepEqual(
    bare.map((b) => b.chapter),
    [TOUR_CHAPTER.ASKED, TOUR_CHAPTER.CHANGE, TOUR_CHAPTER.CHANGE],
  );
  assert.equal(bare[1].say, "Added the link.", "falls back to the handoff's line");

  // Roughly a minute for a full story, never a blink per beat.
  assert.equal(readMs("Short."), 3200);
  assert.equal(readMs("word ".repeat(200)), 9500);
  const total = owner.reduce((ms, b) => ms + readMs(b.say), 0);
  assert.ok(total > 25_000 && total < 90_000, `a full owner story reads in ~a minute (${total}ms)`);
}

// ---- caption clears the host's bottom bar ----
// 2026-10-07: on Substrata at 390px the phone tab bar and the floating ASK
// button sat on top of the caption and its "Looks right" button.
{
  const vw = 390;
  const vh = 760;
  const tabBar = { top: 690, bottom: 760, width: 390 };
  const askButton = { top: 640, bottom: 704, width: 72 };
  assert.equal(bottomBarInset([tabBar, askButton], vw, vh), 70, "rises above a full-width tab bar");
  assert.equal(bottomBarInset([askButton], vw, vh), 0, "a floating button is covered, not avoided");
  assert.equal(
    bottomBarInset([{ top: 0, bottom: 760, width: 390 }], vw, vh),
    0,
    "an app shell filling the screen is not a bar",
  );
  assert.equal(
    bottomBarInset([{ top: 20, bottom: 80, width: 390 }], vw, vh),
    0,
    "a top header is not a bottom bar",
  );
}

console.log("feedback-tour: ok");
