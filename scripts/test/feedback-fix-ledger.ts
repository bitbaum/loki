// Pure tests for the fix ledger (src/lib/feedback/fix-shipping.ts): what
// happens to a fix after the agent finished, and the one canonical live URL.
//
// Regression pins:
// 1. "Check live" at run close was a lie — the agent's job ends at a PR, so
//    a fresh success is PR_OPEN, never DEPLOYED, until GitHub says merged and
//    a deploy-like workflow succeeded on the merge commit.
// 2. The live page is the PROJECT's origin + the reported path. A visitor on a
//    preview host or a fixture URL (…example/) must not become the link.
import assert from "node:assert/strict";
import { composeFeedbackFixPrompt } from "../../src/lib/feedback/compose-dispatch";
import {
  deriveShippingFromPr,
  firstSentence,
  FIX_SHIP_STATE,
  FIX_REFRESH_MS,
  fixCheckedAtMs,
  fixNeedsRefresh,
  isFixShipTerminal,
  livePageHref,
  parseGithubRepoRef,
  parsePrRef,
  pickDeployRun,
  resolveFixPrRef,
} from "../../src/lib/feedback/fix-shipping";
import {
  deriveFeedbackWork,
  FEEDBACK_WORK_PHASE,
  WAITING_ON,
} from "../../src/lib/feedback/work-phase";
import { FEEDBACK_STATUS } from "../../src/lib/constants/statuses";
import { ORCH_STATE, ORCHESTRATION_OUTCOME } from "../../src/lib/orchestration/contract";

const GIT = "https://github.com/bitbaum/dogfood-site-sep10-1201";

// PR reference from the handoff — the real handoff from 2026-09-11.
{
  const done =
    'Added a one-line "Last updated" note (rendered at build time) to the home page footer per visitor feedback; opened PR #1 on branch feat/footer-last-updated (commit 6b9015f), no CI checks configured on this repo so nothing is red.';
  const ref = parsePrRef(done, GIT);
  assert.deepEqual(ref, {
    owner: "bitbaum",
    repo: "dogfood-site-sep10-1201",
    number: 1,
    url: `${GIT}/pull/1`,
  });
  assert.equal(parsePrRef(done, null), null, "a bare number without a repo means nothing");
  assert.deepEqual(
    parsePrRef("see https://github.com/o/r/pull/7 please", GIT)?.url,
    "https://github.com/o/r/pull/7",
    "a full URL wins over the project repo",
  );
  assert.equal(parsePrRef("no pull request opened", GIT), null);
  assert.deepEqual(parseGithubRepoRef("git@github.com:bitbaum/annushka.git"), {
    owner: "bitbaum",
    repo: "annushka",
  });
}

// GitHub's answer → state.
{
  const at = "2026-09-11T12:00:00.000Z";
  const open = {
    number: 1,
    html_url: `${GIT}/pull/1`,
    title: "t",
    state: "open" as const,
    merged_at: null,
    merge_commit_sha: null,
  };
  assert.equal(deriveShippingFromPr(open, null, at).state, FIX_SHIP_STATE.PR_OPEN);
  assert.equal(
    deriveShippingFromPr({ ...open, state: "closed" }, null, at).state,
    FIX_SHIP_STATE.PR_CLOSED,
  );
  const merged = { ...open, state: "closed" as const, merged_at: at, merge_commit_sha: "abc" };
  assert.equal(
    deriveShippingFromPr(merged, null, at).state,
    FIX_SHIP_STATE.MERGED,
    "merged with no runs seen = merged",
  );
  assert.equal(
    deriveShippingFromPr(
      merged,
      [{ name: "CI", status: "completed", conclusion: "success", html_url: null }],
      at,
    ).state,
    FIX_SHIP_STATE.MERGED,
    "a CI-only repo cannot prove a deploy",
  );
  assert.equal(
    deriveShippingFromPr(
      merged,
      [{ name: "Deploy", status: "in_progress", conclusion: null, html_url: null }],
      at,
    ).state,
    FIX_SHIP_STATE.DEPLOYING,
  );
  assert.equal(
    deriveShippingFromPr(
      merged,
      [{ name: "Deploy", status: "completed", conclusion: "success", html_url: "u" }],
      at,
    ).state,
    FIX_SHIP_STATE.DEPLOYED,
  );
  assert.equal(
    deriveShippingFromPr(
      merged,
      [{ name: "Deploy", status: "completed", conclusion: "failure", html_url: "u" }],
      at,
    ).state,
    FIX_SHIP_STATE.DEPLOY_FAILED,
  );
  assert.equal(
    deriveShippingFromPr(
      merged,
      [{ name: "Deploy", status: "completed", conclusion: "skipped", html_url: "u" }],
      at,
    ).state,
    FIX_SHIP_STATE.MERGED,
    "a skipped deploy proves nothing either way",
  );
  assert.equal(
    pickDeployRun([
      { name: "Deploy", status: "completed", conclusion: "skipped", html_url: null },
      { name: "Deploy", status: "completed", conclusion: "success", html_url: null },
    ])?.conclusion,
    "success",
    "a later successful Deploy beats an earlier skipped one",
  );
  assert.equal(isFixShipTerminal(FIX_SHIP_STATE.DEPLOYED), true);
  assert.equal(isFixShipTerminal(FIX_SHIP_STATE.PR_OPEN), false);
}

// Refresh economics.
{
  const now = Date.now();
  assert.equal(fixNeedsRefresh(null, { now }), true);
  assert.equal(
    fixNeedsRefresh(
      {
        state: FIX_SHIP_STATE.DEPLOYED,
        checkedAt: new Date(now - 10 * FIX_REFRESH_MS).toISOString(),
      },
      { now },
    ),
    false,
    "terminal = never again",
  );
  assert.equal(
    fixNeedsRefresh(
      { state: FIX_SHIP_STATE.PR_OPEN, checkedAt: new Date(now - 1000).toISOString() },
      { now },
    ),
    false,
    "fresh = wait",
  );
  assert.equal(
    fixNeedsRefresh(
      {
        state: FIX_SHIP_STATE.PR_OPEN,
        checkedAt: new Date(now - FIX_REFRESH_MS - 1).toISOString(),
      },
      { now },
    ),
    true,
  );
}

// The canonical live page.
{
  assert.equal(
    livePageHref("https://annushka.orangecat.ch", "https://annushka.orangecat.ch/en/", "/en/"),
    "https://annushka.orangecat.ch/en/",
  );
  assert.equal(
    livePageHref(
      "https://dogfood-site-sep10-1201.orangecat.ch",
      "https://dogfood-site-sep10-1201.example/",
      "/",
    ),
    "https://dogfood-site-sep10-1201.orangecat.ch/",
    "a fixture host never becomes the link when the project has a live URL",
  );
  assert.equal(
    livePageHref("https://site.example/", "https://preview-42.vercel.app/pricing?x=1", "/pricing"),
    "https://site.example/pricing?x=1",
    "path and query travel, the preview host does not",
  );
  assert.equal(
    livePageHref(null, "https://only-reported.example/a", "/a"),
    "https://only-reported.example/a",
    "no live URL = the reported one",
  );
  assert.equal(
    livePageHref("https://site.example", null, "/contact"),
    "https://site.example/contact",
  );
  assert.equal(livePageHref(null, null, "/contact"), null);
}

// The row's words per state.
{
  const base = {
    id: "r",
    state: ORCH_STATE.DONE,
    outcome: ORCHESTRATION_OUTCOME.SUCCESS,
    startedAt: new Date(),
    finishedAt: new Date(),
    deliveredAt: null,
    lastProgressAt: null,
    error: null,
    summaryDone:
      "Added the About page; opened PR #2 on branch feat/about (commit 4252c90), checks green.",
  };
  const at = new Date().toISOString();
  const pr = { number: 2, url: `${GIT}/pull/2`, title: "About page" };
  const open = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, {
    ...base,
    fix: { state: FIX_SHIP_STATE.PR_OPEN, pr, checkedAt: at },
  });
  assert.equal(open.phase, FEEDBACK_WORK_PHASE.NEEDS_VERIFY);
  assert.equal(open.label, "PR #2 · open");
  assert.equal(open.checkLive, undefined, "an open PR is NOT a reason to check the live page");
  assert.equal(open.didLine, "Added the About page;");
  const live = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, {
    ...base,
    fix: { state: FIX_SHIP_STATE.DEPLOYED, pr, checkedAt: at },
  });
  assert.equal(live.label, "Shipped · confirm");
  assert.equal(live.checkLive, true);
  const none = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, {
    ...base,
    fix: { state: FIX_SHIP_STATE.NO_EVIDENCE, checkedAt: at },
  });
  assert.equal(none.label, "Finished · nothing shipped");
  const closed = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, {
    ...base,
    fix: { state: FIX_SHIP_STATE.PR_CLOSED, pr, checkedAt: at },
  });
  assert.equal(
    closed.phase,
    FEEDBACK_WORK_PHASE.FAILED,
    "closed without merge is a failure with Retry",
  );
  const pending = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, { ...base, fix: null });
  assert.equal(pending.label, "Finished");
  assert.equal(pending.checkLive, undefined, "no ledger yet = no live claim");
  assert.equal(firstSentence("Short."), "Short.");
  assert.equal(firstSentence("x".repeat(200)).length, 160);
  // An abbreviation's full stop is not an end (the card once read "…checks incl.").
  assert.equal(
    firstSentence("Rebuilt the home page, verified 115/115 checks incl. Playwright. Then more."),
    "Rebuilt the home page, verified 115/115 checks incl. Playwright.",
  );
  assert.equal(
    firstSentence("Moved the menu, e.g. on phones. Rest."),
    "Moved the menu, e.g. on phones.",
  );
}

console.log("feedback-fix-ledger: ok");

// Who is blocked — the inbox's grouping key. The page asks one question
// ("is anything waiting on me?") and DB status could not answer it: a fix
// that merged and deployed an hour ago sat under "In progress" next to an
// agent mid-run, so the row that needed a person read as the one that didn't.
{
  const at = new Date().toISOString();
  const pr = { number: 2, url: `${GIT}/pull/2`, title: "t" };
  const closedRun = {
    id: "r",
    state: ORCH_STATE.DONE,
    outcome: ORCHESTRATION_OUTCOME.SUCCESS,
    startedAt: new Date(),
    finishedAt: new Date(),
    deliveredAt: null,
    lastProgressAt: null,
    error: null,
    summaryDone: "opened PR #2",
  };
  const waitingFor = (state: (typeof FIX_SHIP_STATE)[keyof typeof FIX_SHIP_STATE] | null) =>
    deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, {
      ...closedRun,
      fix: state ? { state, pr, checkedAt: at } : null,
    }).waitingOn;

  assert.equal(
    waitingFor(FIX_SHIP_STATE.PR_OPEN),
    WAITING_ON.MACHINE,
    "a green PR auto-merges — nothing for a person to do",
  );
  assert.equal(waitingFor(FIX_SHIP_STATE.DEPLOYING), WAITING_ON.MACHINE);
  assert.equal(waitingFor(null), WAITING_ON.MACHINE, "still asking GitHub where the PR is");
  assert.equal(
    waitingFor(FIX_SHIP_STATE.DEPLOYED),
    WAITING_ON.YOU,
    "deployed = look at it and confirm",
  );
  assert.equal(waitingFor(FIX_SHIP_STATE.MERGED), WAITING_ON.YOU);
  assert.equal(waitingFor(FIX_SHIP_STATE.NO_EVIDENCE), WAITING_ON.YOU);
  assert.equal(waitingFor(FIX_SHIP_STATE.PUSHED), WAITING_ON.YOU);
  assert.equal(waitingFor(FIX_SHIP_STATE.PR_CLOSED), WAITING_ON.YOU);
  assert.equal(waitingFor(FIX_SHIP_STATE.DEPLOY_FAILED), WAITING_ON.YOU);

  // The rest of the ladder.
  assert.equal(deriveFeedbackWork(FEEDBACK_STATUS.NEW, null).waitingOn, WAITING_ON.YOU);
  assert.equal(deriveFeedbackWork(FEEDBACK_STATUS.RESOLVED, null).waitingOn, WAITING_ON.NOBODY);
  assert.equal(deriveFeedbackWork(FEEDBACK_STATUS.ARCHIVED, null).waitingOn, WAITING_ON.NOBODY);
  assert.equal(
    deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, {
      ...closedRun,
      state: ORCH_STATE.RUNNING,
      outcome: null,
    }).waitingOn,
    WAITING_ON.MACHINE,
    "an agent generating is not waiting on you",
  );
  assert.equal(
    deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, {
      ...closedRun,
      state: ORCH_STATE.WAITING,
      outcome: null,
      startedAt: new Date(Date.now() - 30 * 60_000),
      deliveredAt: new Date(Date.now() - 29 * 60_000).toISOString(),
      lastProgressAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    }).waitingOn,
    WAITING_ON.YOU,
    "Stalled is a person's problem — the bug that put it under 'In progress'",
  );
}

console.log("feedback-waiting-on: ok");

// Copy discipline. Two rules the row kept breaking:
//  1. The badge is a STATUS, not a sentence — "Live (partial) · confirm" is
//     three ideas in a chip, and "partial" is the agent's word about its own
//     session, not something a person reads at a glance.
//  2. A detail line must carry what the badge and buttons cannot. "Merged and
//     deployed. Open the live page, confirm… then Confirm" printed the same
//     18 words on every deployed row, next to buttons already labelled
//     "Check live" and "Confirm".
{
  const at = new Date().toISOString();
  const pr = { number: 9, url: `${GIT}/pull/9`, title: "t" };
  const run = {
    id: "r",
    state: ORCH_STATE.DONE,
    outcome: ORCHESTRATION_OUTCOME.PARTIAL,
    startedAt: new Date(),
    finishedAt: new Date(),
    deliveredAt: null,
    lastProgressAt: null,
    error: null,
    summaryDone: "opened PR #9",
    fix: { state: FIX_SHIP_STATE.DEPLOYED, pr, checkedAt: at },
  };
  const partialLive = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, run);
  assert.equal(partialLive.label, "Shipped · confirm", "the badge never carries (partial)");
  assert.match(
    partialLive.detail ?? "",
    /partial success/,
    "partial is said in the sentence instead",
  );

  const cleanLive = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, {
    ...run,
    outcome: ORCHESTRATION_OUTCOME.SUCCESS,
  });
  assert.equal(cleanLive.label, "Shipped · confirm");
  assert.equal(cleanLive.detail, null, "a clean deployed row says nothing its buttons already say");
}

console.log("feedback-copy: ok");
// The dispatch prompt must not promise the agent that its PR merges itself.
// Site provisioning writes deploy.yml and nothing else (src/lib/site-cd.ts),
// so "an opened PR with passing checks counts as shipped" was false, and two
// green agent PRs sat open on a dogfood site for a day because of it.
{
  const prompt = composeFeedbackFixPrompt(
    {
      suggestion: "Fix the opening hours.",
      duplicateCount: 1,
      url: "https://harbour-bakery.example/contact",
      page: "/contact",
      scope: "page",
      selectedElements: null,
    },
    "Harbour Bakery",
  );
  assert.doesNotMatch(prompt, /auto-merge\.yml/, "never name a workflow the site may not have");
  assert.doesNotMatch(prompt, /counts as shipped/, "an open PR is progress, not a shipped fix");
  assert.match(prompt, /do not merge it yourself/, "the agent still may not merge its own work");
}

console.log("feedback-ship-instruction: ok");

// A handoff names more than one pull request more often than you would think.
// The real one, from dogfood-site-sep10-1201 on 2026-09-11, after a retry:
// taking the FIRST number reported the CLOSED pull request and told the
// operator nothing had shipped, while #3 sat open and mergeable.
{
  const retry =
    'Added a build-time "Last updated" date line to the shared footer (renders on the home page) per visitor feedback; redone from scratch on branch feat/footer-last-updated-v2 off current main after prior PR #1 diverged and conflicted (closed #1, opened #3, "test" check green).';
  assert.equal(
    parsePrRef(retry, GIT)?.number,
    3,
    "the pull request it OPENED, not the one it closed",
  );

  // The plain case still resolves the same way.
  assert.equal(parsePrRef("opened PR #1 on branch feat/x (commit abc)", GIT)?.number, 1);

  // No "opened" cue anywhere: a later pull request supersedes an earlier one.
  assert.equal(
    parsePrRef("superseded PR #4 with PR #9", GIT)?.number,
    9,
    "highest wins when nothing says which was opened",
  );

  // A BARE #number is not assumed to be a pull request — in prose it is far
  // more often an issue, and resolving the wrong thing is worse than resolving
  // nothing. It counts only with "PR"/"pull request"/"pull/" or after "opened".
  assert.equal(parsePrRef("fixes #12", GIT), null, "a bare number is not a pull request");
  assert.equal(
    parsePrRef("opened #12", GIT)?.number,
    12,
    "…unless the sentence says it was opened",
  );

  // A full URL still carries its own repo, and still loses to an explicit open.
  assert.equal(
    parsePrRef(
      "closed https://github.com/o/r/pull/2 and opened https://github.com/o/r/pull/5",
      null,
    )?.url,
    "https://github.com/o/r/pull/5",
  );
  assert.equal(parsePrRef("nothing to see", GIT), null);
}

console.log("feedback-pr-ref: ok");

// ── One resolution, or the cache fights the thing that fills it ─────────────
//
// The refresher preferred the reaper's repo evidence; the cache-validity check
// read only the handoff. When a run's evidence and handoff named different
// pull requests they disagreed forever: the cached ledger could never equal the
// expected url, so every single inbox request re-fetched GitHub for that row.
// resolveFixPrRef is now the one answer both of them ask for.
{
  const handoffOnly = { summaryDone: "opened PR #7 on branch feat/x", gitUrl: GIT };
  assert.equal(resolveFixPrRef(handoffOnly)?.number, 7);

  const disagreeing = {
    summaryDone: "opened PR #7 on branch feat/x",
    evidence: { kind: "pr", url: `${GIT}/pull/9`, title: "t" },
    gitUrl: GIT,
  };
  assert.equal(
    resolveFixPrRef(disagreeing)?.number,
    9,
    "repo evidence is window-bounded API fact; the handoff is prose the model wrote",
  );

  // A push (not a pull request) is not a pull request reference.
  assert.equal(
    resolveFixPrRef({
      summaryDone: "opened PR #7",
      evidence: { kind: "push", url: `${GIT}/tree/feat/x`, title: "push" },
      gitUrl: GIT,
    })?.number,
    7,
    "only evidence of kind 'pr' outranks the handoff",
  );
  assert.equal(resolveFixPrRef({ summaryDone: null, gitUrl: GIT }), null);

  // The property that actually matters: whatever the inputs, the value the
  // cache is validated against equals the value the refresher would store.
  for (const input of [handoffOnly, disagreeing, { summaryDone: "nothing", gitUrl: GIT }]) {
    const a = resolveFixPrRef(input);
    const b = resolveFixPrRef(input);
    assert.deepEqual(a, b, "same inputs, same pull request — no drift between callers");
  }
}

// ── Oldest-first, or rows past the cap are never looked at again ────────────
{
  const at = (iso) => ({ state: FIX_SHIP_STATE.PR_OPEN, checkedAt: iso });
  assert.equal(fixCheckedAtMs(null), 0, "never checked sorts first");
  assert.equal(fixCheckedAtMs(undefined), 0);
  assert.equal(fixCheckedAtMs({ state: FIX_SHIP_STATE.PR_OPEN, checkedAt: "nonsense" }), 0);
  assert.ok(
    fixCheckedAtMs(at("2026-09-11T10:00:00.000Z")) < fixCheckedAtMs(at("2026-09-11T11:00:00.000Z")),
  );

  // The inbox refreshes a bounded number per request. In list order (newest
  // first) everything past the bound was permanently stale; by this key the
  // bound is a rate limit and every row gets its turn.
  const rows = [
    { id: "newest", fix: at("2026-09-11T12:00:00.000Z") },
    { id: "never", fix: null },
    { id: "oldest", fix: at("2026-09-11T09:00:00.000Z") },
    { id: "middle", fix: at("2026-09-11T10:30:00.000Z") },
  ];
  assert.deepEqual(
    [...rows].sort((a, b) => fixCheckedAtMs(a.fix) - fixCheckedAtMs(b.fix)).map((r) => r.id),
    ["never", "oldest", "middle", "newest"],
  );
}

console.log("feedback-ledger-fairness: ok");
