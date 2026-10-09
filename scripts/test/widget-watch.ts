// Watch mode's trail and reports: privacy by construction (labels, never
// values; paths, never query strings), one report per distinct failure, and a
// report that names what broke before what led there.
// Run: npx tsx scripts/test/widget-watch.ts
import assert from "node:assert/strict";
import {
  describeControl,
  describeRequest,
  failureSignature,
  freshTrail,
  isFailedRequest,
  isNoiseError,
  isNoticeableRequest,
  nextTapStreak,
  noticeCount,
  pushTrail,
  REVIEW_SESSION_MAX,
  sessionForReview,
  SLOW_REQUEST_MS,
  TRAIL_MAX,
  TRAIL_MAX_AGE_MS,
  watchReport,
  explainChecks,
  checksSignature,
  explainNotice,
  noticeSignature,
  type TrailEntry,
} from "../../widget/watch-trail";
import { buildSuggestion } from "../../widget/report-payload";

let n = 0;
const check = (fn: () => void) => {
  fn();
  n++;
};

check(() => {
  assert.equal(
    describeControl({ tag: "BUTTON", text: "  Save\n project " }),
    "button “Save project”",
  );
  assert.equal(describeControl({ tag: "a", label: "Open profile" }), "link “Open profile”");
  // An input is named by its placeholder — what was typed never appears.
  assert.equal(
    describeControl({ tag: "input", type: "email", placeholder: "Your email" }),
    "email field “Your email”",
  );
  assert.equal(describeControl({ tag: "div", role: "button" }), "button");
});
check(() => {
  assert.equal(
    describeRequest("post", "https://orangecat.ch/api/projects?token=secret", 500),
    "POST /api/projects → 500",
  );
  assert.equal(describeRequest("get", "/shop/x", null), "GET /shop/x → no response");
  assert.equal(isFailedRequest(500), true);
  assert.equal(isFailedRequest(null), true);
  assert.equal(isFailedRequest(404), false);
});
check(() => {
  let t: TrailEntry[] = [];
  for (let i = 0; i < TRAIL_MAX + 5; i++) t = pushTrail(t, { at: i, kind: "tap", text: `b${i}` });
  assert.equal(t.length, TRAIL_MAX);
  const before = t.length;
  t = pushTrail(t, { at: 99, kind: "tap", text: `b${TRAIL_MAX + 4}` });
  assert.equal(t.length, before, "a repeat of the last entry is one fact");
});
check(() => {
  assert.equal(isNoiseError("ResizeObserver loop limit exceeded"), true);
  assert.equal(isNoiseError("Script error."), true);
  assert.equal(isNoiseError("TypeError: cannot read properties of undefined"), false);
  assert.equal(
    failureSignature({ kind: "request", text: "GET /api/projects/123 → 500" }),
    failureSignature({ kind: "request", text: "GET /api/projects/456 → 500" }),
  );
});
check(() => {
  const trail: TrailEntry[] = [
    { at: 1000, kind: "page", text: "/projects" },
    { at: 3000, kind: "tap", text: "button “Create”" },
  ];
  const r = watchReport({ kind: "request", text: "POST /api/projects → 500" }, trail, 5000);
  assert.match(r.message, /request failed: POST \/api\/projects → 500/);
  assert.equal(r.diagnostics["step 2"], "tap button “Create” (2s ago)");
  const s = buildSuggestion(r.message, r.diagnostics, 2000);
  assert.ok(s.length <= 2000 && s.includes("failure: POST /api/projects → 500"));
});

check(() => {
  // Three taps on one button inside the window: dead. A field, a gap, or a
  // different button in between: not.
  let r = nextTapStreak(null, "button “Pay”", 0);
  r = nextTapStreak(r.streak, "button “Pay”", 1000);
  assert.equal(r.dead, false);
  r = nextTapStreak(r.streak, "button “Pay”", 2000);
  assert.equal(r.dead, true);
  let f = nextTapStreak(null, "email field “Your email”", 0);
  f = nextTapStreak(f.streak, "email field “Your email”", 100);
  f = nextTapStreak(f.streak, "email field “Your email”", 200);
  assert.equal(f.dead, false, "fields are tapped to focus");
  let g = nextTapStreak(null, "button “Pay”", 0);
  g = nextTapStreak(g.streak, "button “Pay”", 1000);
  g = nextTapStreak(g.streak, "button “Pay”", 9000);
  assert.equal(g.dead, false, "outside the window it starts again");
  const rep = watchReport({ kind: "dead-tap", text: "button “Pay”" }, [], 0);
  assert.match(rep.message, /tapped button “Pay” three times and nothing happened/);
});

// ---- Review: what a reviewer remarks on that is not a failure ----
check(() => {
  assert.equal(describeRequest("get", "/a?x=1", 200, 4230), "GET /a → 200 in 4.2s");
  assert.equal(isNoticeableRequest(404, 50), true, "a 404 is worth a remark");
  assert.equal(isNoticeableRequest(200, SLOW_REQUEST_MS), true, "so is a slow answer");
  assert.equal(isNoticeableRequest(200, 120), false);
  // 5xx and no-answer are failures (they file a fix) — never also a remark.
  assert.equal(isNoticeableRequest(500, 9000), false);
  assert.equal(isNoticeableRequest(null, 9000), false);
});

check(() => {
  const now = 10_000_000;
  const kept = freshTrail(
    [
      { at: now - TRAIL_MAX_AGE_MS - 1, kind: "tap", text: "yesterday" },
      { at: now - 1000, kind: "tap", text: "button “Go”" },
      { at: now - 500, kind: "bogus", text: "x" },
      { at: "soon", kind: "tap", text: "x" },
      { at: now + 60_000, kind: "tap", text: "from the future" },
      null,
    ],
    now,
  );
  assert.deepEqual(kept, [{ at: now - 1000, kind: "tap", text: "button “Go”" }]);
  assert.deepEqual(freshTrail("not json array", now), [], "stored garbage is an empty trail");
});

check(() => {
  const t: TrailEntry[] = [
    { at: 0, kind: "page", text: "/shop" },
    { at: 1_000, kind: "tap", text: "button “Buy”" },
    { at: 1_200, kind: "notice", text: "POST /cart → 404 in 0.2s" },
    { at: 45_000, kind: "tap", text: "link “Help”" },
  ];
  assert.equal(noticeCount(t), 1);
  const s = sessionForReview(t, ["2 image(s) have no alt text"], 90_000);
  assert.match(s, /page \/shop\ntap button “Buy”\nnotice POST \/cart → 404/);
  assert.match(s, /\(paused 44s\)\ntap link “Help”/, "a long stop before a step is written out");
  assert.match(s, /nothing for 45s, then asked for this review/);
  assert.match(s, /Checks on the page they are on now:\n- 2 image\(s\) have no alt text/);
});

check(() => {
  // Too long: the OLDEST steps go, the checks and the newest steps stay.
  const t: TrailEntry[] = Array.from({ length: TRAIL_MAX }, (_, i) => ({
    at: i,
    kind: "tap" as const,
    text: `button “${String(i).padStart(3, "0")} ${"x".repeat(140)}”`,
  }));
  const s = sessionForReview(t, ["check A"], TRAIL_MAX);
  assert.ok(s.length <= REVIEW_SESSION_MAX, `capped (${s.length})`);
  assert.ok(s.includes(`button “${String(TRAIL_MAX - 1).padStart(3, "0")}`), "newest kept");
  assert.ok(!s.includes("button “000"), "oldest dropped");
  assert.ok(s.endsWith("- check A"), "checks survive the cut");
});

// ---- Loki speaks up: each remark in plain words, with the fix it would send ----
check(() => {
  const nf = explainNotice({
    kind: "4xx",
    text: "GET /hours → 404",
    after: "button “Opening hours”",
  });
  assert.equal(
    nf.say,
    "After you tapped button “Opening hours”, the page asked for /hours and it found nothing there (404).",
  );
  assert.match(
    nf.fix,
    /^Fix the request to \/hours after tapping button “Opening hours”: it answers 404\.$/,
  );
  // No tap to blame: the sentence still stands on its own.
  assert.match(
    explainNotice({ kind: "4xx", text: "POST /cart → 403" }).say,
    /^the page asked for \/cart and it was refused — not allowed\.$/,
  );
  assert.match(
    explainNotice({ kind: "4xx", text: "GET /x → 418" }).say,
    /was rejected \(418\)/,
    "an unlisted status still reads",
  );
  assert.match(
    explainNotice({ kind: "slow", text: "GET /api/menu → 200 in 4.2s" }).say,
    /waited 4\.2s for \/api\/menu/,
  );
  assert.match(
    explainNotice({ kind: "console", text: "console error: x is undefined" }).say,
    /“x is undefined”/,
  );
  assert.match(
    explainNotice({ kind: "load", text: "this page took 4.1s to load" }).say,
    /it took 4\.1s to load/,
  );
  const freeze = explainNotice({
    kind: "longtask",
    text: "after button “Load more” the page froze for 450ms (taps go unanswered meanwhile)",
  });
  assert.match(freeze.say, /^After button “Load more” the page froze for 450ms/);
  assert.equal(freeze.fix, "Stop the page freezing after button “Load more”.");
  assert.match(explainNotice({ kind: "cls", text: "content jumped around" }).fix, /jumping around/);
});

check(() => {
  assert.equal(explainChecks([]), null, "a clean page gets no remark — silence is right");
  // One finding, two counts, two examples: one signature.
  assert.equal(
    checksSignature("/p", ["30 piece(s) of text are under 12px (e.g. “Partners” at 11.84px)"]),
    checksSignature("/p", [
      "6 piece(s) of text are under 12px (e.g. “AI-native studio” at 11.5px)",
    ]),
    "the same kind of finding is said once, whatever the count or example",
  );
  assert.notEqual(
    checksSignature("/p", ["2 image(s) have no alt text"]),
    checksSignature("/p", ["The page has no main heading (h1)"]),
    "a different finding is a different signature",
  );
  assert.notEqual(checksSignature("/p", ["x"]), checksSignature("/q", ["x"]), "per path");
  const c = explainChecks(["2 image(s) have no alt text", "The page has no main heading (h1)"])!;
  assert.match(
    c.say,
    /2 things stand out:\n• 2 image\(s\) have no alt text\n• The page has no main heading/,
  );
  assert.match(c.fix, /^Fix these on this page:\n• 2 image/);
  assert.equal(
    c.short,
    "2 things on this page could be better",
    "the bar's one line never ends on a colon",
  );
  // One remark per cause per page: numbers do not make it new, another page does.
  const a = noticeSignature("/shop", { kind: "slow", text: "GET /a → 200 in 4.2s" });
  assert.equal(a, noticeSignature("/shop", { kind: "slow", text: "GET /a → 200 in 5.9s" }));
  assert.notEqual(a, noticeSignature("/cart", { kind: "slow", text: "GET /a → 200 in 4.2s" }));
});

console.log(`${n} widget-watch cases passed`);
