// Pure tests for "ship fixes automatically" (src/lib/feedback/auto-ship.ts).
//
// This feature merges code without a person present, so every condition that
// stops it is pinned here. The ones that are NOT obvious:
//
//  * "No checks configured" is a HOLD, not a pass. dogfood-site-sep10-1201's
//    first agent PR had zero checks; treating absence-of-red as green would
//    merge on no evidence at all, which is the thing this exists to avoid.
//  * An `unverified` ledger is the agent's own claim (that is the shape the
//    org-restriction 403 produces). Never merge on a claim.
//  * A project whose last shipped fix failed to deploy stops shipping, so the
//    next fix cannot land on top of a site that is already failing to build.
import assert from "node:assert/strict";
import {
  AUTO_SHIP_HOLD,
  autoShipHoldNote,
  decideAutoShip,
  projectsPausedByBrokenDeploy,
  prOpenedByRun,
  prPredatesRun,
  RUN_CLOCK_SLACK_MS,
  type AutoShipInput,
} from "../../src/lib/feedback/auto-ship";
import {
  FIX_SHIP_STATE,
  shipAnnouncementFor,
  type FixShipping,
} from "../../src/lib/feedback/fix-shipping";

const openPr: FixShipping = {
  state: FIX_SHIP_STATE.PR_OPEN,
  pr: { number: 7, url: "https://github.com/bitbaum/site/pull/7", title: "Fix the hours" },
  checkedAt: new Date().toISOString(),
};

const ready: AutoShipInput = {
  autoShip: true,
  fix: openPr,
  fromOurDispatch: true,
  draft: false,
  mergeable: true,
  checkConclusions: ["success"],
  deployBroken: false,
};

const hold = (over: Partial<AutoShipInput>) => {
  const d = decideAutoShip({ ...ready, ...over });
  return d.merge ? null : d.hold;
};

// The one case that merges.
assert.deepEqual(decideAutoShip(ready), { merge: true });
assert.deepEqual(
  decideAutoShip({ ...ready, checkConclusions: ["success", "skipped", "neutral"] }),
  { merge: true },
  "skipped and neutral are not failures",
);

// Opt-in is the gate, and "never chosen" is not consent.
assert.equal(hold({ autoShip: false }), AUTO_SHIP_HOLD.NOT_ENABLED);
assert.equal(hold({ autoShip: null }), AUTO_SHIP_HOLD.NOT_ENABLED, "never chosen ≠ opted in");
assert.equal(hold({ autoShip: undefined }), AUTO_SHIP_HOLD.NOT_ENABLED);

// Evidence.
assert.equal(
  hold({ checkConclusions: [] }),
  AUTO_SHIP_HOLD.NO_CHECKS,
  "no checks is unknown, not green",
);
assert.equal(hold({ checkConclusions: ["failure"] }), AUTO_SHIP_HOLD.CHECKS_NOT_GREEN);
assert.equal(
  hold({ checkConclusions: ["success", null] }),
  AUTO_SHIP_HOLD.CHECKS_NOT_GREEN,
  "a check still running is not a pass",
);
assert.equal(hold({ checkConclusions: ["success", "cancelled"] }), AUTO_SHIP_HOLD.CHECKS_NOT_GREEN);

// Mergeability. GitHub reports `mergeable: null` while it computes — that is
// not permission.
assert.equal(hold({ draft: true }), AUTO_SHIP_HOLD.NOT_MERGEABLE);
assert.equal(hold({ mergeable: false }), AUTO_SHIP_HOLD.NOT_MERGEABLE);
// Unknown is still a hold — it is never permission — but it is NOT the same
// hold, because the row must not tell someone their pull request has
// conflicts when GitHub has not finished looking. Observed live 2026-09-11:
// GitHub computes mergeability lazily and answers null on a cold read.
assert.equal(hold({ mergeable: null }), AUTO_SHIP_HOLD.MERGE_UNKNOWN, "unknown is not a conflict");
assert.notEqual(
  autoShipHoldNote(AUTO_SHIP_HOLD.MERGE_UNKNOWN),
  autoShipHoldNote(AUTO_SHIP_HOLD.NOT_MERGEABLE),
  "two different situations owe the reader two different sentences",
);
assert.doesNotMatch(
  autoShipHoldNote(AUTO_SHIP_HOLD.MERGE_UNKNOWN) ?? "",
  /conflict|draft/i,
  "never assert a cause nobody checked",
);

// Only our own pull request, and only one that is actually open and verified.
assert.equal(hold({ fromOurDispatch: false }), AUTO_SHIP_HOLD.NOT_OURS);
assert.equal(hold({ fix: null }), AUTO_SHIP_HOLD.NOT_OPEN);
assert.equal(hold({ fix: { ...openPr, state: FIX_SHIP_STATE.MERGED } }), AUTO_SHIP_HOLD.NOT_OPEN);
assert.equal(
  hold({ fix: { ...openPr, unverified: true } }),
  AUTO_SHIP_HOLD.NOT_OPEN,
  "never merge on the agent's claim",
);
assert.equal(
  hold({ fix: { state: FIX_SHIP_STATE.PR_OPEN, checkedAt: openPr.checkedAt } }),
  AUTO_SHIP_HOLD.NOT_OPEN,
  "no PR object, nothing to merge",
);

// A broken deploy stops the project, ahead of every other check.
assert.equal(hold({ deployBroken: true }), AUTO_SHIP_HOLD.DEPLOY_BROKEN);
assert.equal(
  hold({ deployBroken: true, checkConclusions: [] }),
  AUTO_SHIP_HOLD.DEPLOY_BROKEN,
  "the broken deploy is the thing to report, not the missing checks",
);

// Only holds a person can act on get a sentence on the row.
for (const h of [
  AUTO_SHIP_HOLD.NO_CHECKS,
  AUTO_SHIP_HOLD.CHECKS_NOT_GREEN,
  AUTO_SHIP_HOLD.NOT_MERGEABLE,
  AUTO_SHIP_HOLD.DEPLOY_BROKEN,
])
  assert.ok((autoShipHoldNote(h) ?? "").length > 20, `${h} owes the reader a sentence`);
for (const h of [AUTO_SHIP_HOLD.NOT_ENABLED, AUTO_SHIP_HOLD.NOT_OPEN, AUTO_SHIP_HOLD.NOT_OURS])
  assert.equal(autoShipHoldNote(h), null, `${h} is not news to anyone`);

console.log("feedback-auto-ship: ok");

// ── The guard that was decoration ───────────────────────────────────────────
//
// `fromOurDispatch` existed as a field and was passed a hardcoded `true`, so
// nothing checked it. It matters because the pull request is resolved from
// PROSE the agent wrote: a handoff that merely mentions a number ("same
// approach as PR #42") would hand #42 to the merge call, and #42 can be a
// person's unrelated work. GitHub's created_at is the hard fact — a run exists
// before any agent touches the repo, so its pull request is always newer.
{
  const runStart = "2026-09-11T12:00:00.000Z";
  const t = (deltaMs: number) => new Date(Date.parse(runStart) + deltaMs).toISOString();

  assert.equal(prOpenedByRun(t(60_000), runStart), true, "opened a minute into the run");
  assert.equal(prOpenedByRun(t(5 * 60_000), runStart), true);
  assert.equal(
    prOpenedByRun(t(-30_000), runStart),
    true,
    "30s before the run row: clock skew, not someone else's work",
  );
  assert.equal(
    prOpenedByRun(t(-RUN_CLOCK_SLACK_MS - 1), runStart),
    false,
    "older than the slack window — a previous attempt, or a person's PR",
  );
  assert.equal(prOpenedByRun(t(-86_400_000), runStart), false, "yesterday's pull request");
  assert.equal(prOpenedByRun(null, runStart), false, "no created_at = no proof = no merge");
  assert.equal(prOpenedByRun(t(60_000), null), false, "no run start = no proof = no merge");
  assert.equal(prOpenedByRun("not a date", runStart), false);
  assert.equal(prOpenedByRun(t(60_000), new Date(Date.parse(runStart))), true, "Date works too");

  // The real numbers, from dogfood-site-sep10-1201 on 2026-09-11. This is the
  // best pin available: the guard must admit the merge that legitimately
  // happened AND reject the exact pull request the parser wrongly resolved
  // before it was fixed. It is a second, independent line of defence against
  // that bug — prose said #1, but #1 predates the run by six hours.
  {
    const RUN_STARTED = "2026-09-11T16:13:25Z";
    assert.equal(
      prOpenedByRun("2026-09-11T16:15:37Z", RUN_STARTED),
      true,
      "PR #3, opened two minutes into the run — merged for real",
    );
    assert.equal(
      prOpenedByRun("2026-09-11T10:21:48Z", RUN_STARTED),
      false,
      "PR #1, six hours older — the one the parser wrongly named",
    );
  }

  // And the decision honours it.
  assert.equal(
    hold({ fromOurDispatch: false }),
    AUTO_SHIP_HOLD.NOT_OURS,
    "a pull request this run did not open is never merged",
  );

  // ── The same rule, for what the operator is TOLD ──────────────────────────
  //
  // prPredatesRun is what stops a mentioned number rendering "Live · confirm"
  // on a report nothing was done about. It is deliberately not the negation of
  // prOpenedByRun: both answer false when the timestamps are unknown, so an
  // unknown never merges AND never demotes a real fix to "nothing shipped".
  assert.equal(
    prPredatesRun(t(-RUN_CLOCK_SLACK_MS - 1), runStart),
    true,
    "older than the slack window — the run cannot have produced it",
  );
  assert.equal(prPredatesRun(t(-86_400_000), runStart), true, "yesterday's pull request");
  assert.equal(prPredatesRun(t(60_000), runStart), false, "opened during the run — ours");
  assert.equal(
    prPredatesRun(t(-30_000), runStart),
    false,
    "inside the slack window is clock skew, not someone else's work",
  );

  // The unknown case, stated twice because it is the whole design: neither
  // predicate fires, so a missing created_at leaves the ledger exactly as it
  // was rather than merging it or contradicting it.
  for (const [prAt, run] of [
    [null, runStart],
    [t(60_000), null],
    ["not a date", runStart],
  ] as const) {
    assert.equal(prOpenedByRun(prAt, run), false, "unknown never merges");
    assert.equal(prPredatesRun(prAt, run), false, "unknown never discounts a real fix");
  }

  // The real numbers again (dogfood-site-sep10-1201, 2026-09-11): the pull
  // request the parser wrongly named is six hours older than the run, so the
  // ledger must discount it — that shape is what printed a false "Live".
  assert.equal(
    prPredatesRun("2026-09-11T10:21:48Z", "2026-09-11T16:13:25Z"),
    true,
    "PR #1, six hours older — discounted, never reported as shipped",
  );
  assert.equal(
    prPredatesRun("2026-09-11T16:15:37Z", "2026-09-11T16:13:25Z"),
    false,
    "PR #3, opened two minutes in — the real fix, still reported",
  );
}

// ── A pause that can be lifted ──────────────────────────────────────────────
//
// One failed deploy pauses a project. Counting RESOLVED and ARCHIVED rows meant
// the pause never lifted: a deploy_failed ledger is terminal, so the project
// stayed paused forever and nothing in the product could end it.
{
  const HANDLED = ["resolved", "archived"];
  const broken = { state: FIX_SHIP_STATE.DEPLOY_FAILED };
  const fine = { state: FIX_SHIP_STATE.DEPLOYED };

  assert.deepEqual(
    [
      ...projectsPausedByBrokenDeploy(
        [{ projectId: "p1", status: "dispatched" }],
        () => broken,
        HANDLED,
      ),
    ],
    ["p1"],
    "an open row with a failed deploy pauses its project",
  );
  assert.equal(
    projectsPausedByBrokenDeploy([{ projectId: "p1", status: "resolved" }], () => broken, HANDLED)
      .size,
    0,
    "resolving it is the operator saying they handled it — the pause lifts",
  );
  assert.equal(
    projectsPausedByBrokenDeploy([{ projectId: "p1", status: "archived" }], () => broken, HANDLED)
      .size,
    0,
    "archiving lifts it too",
  );
  assert.equal(
    projectsPausedByBrokenDeploy([{ projectId: "p1", status: "dispatched" }], () => fine, HANDLED)
      .size,
    0,
  );
  assert.equal(
    projectsPausedByBrokenDeploy([{ projectId: "p1", status: "new" }], () => null, HANDLED).size,
    0,
    "no ledger, no pause",
  );
  // One project's failure never pauses another's.
  assert.deepEqual(
    [
      ...projectsPausedByBrokenDeploy(
        [
          { projectId: "p1", status: "dispatched" },
          { projectId: "p2", status: "dispatched" },
        ],
        (i) => (i.projectId === "p1" ? broken : fine),
        HANDLED,
      ),
    ],
    ["p1"],
  );
}

console.log("feedback-auto-ship-guards: ok");

// ── Announce the transition, never the state ────────────────────────────────
//
// The loop announced "a visitor filed something" and "an agent's run closed".
// Neither is the event a person cares about: a run closes at a pull request,
// and the product changes later. With automatic merging on, a deploy that
// fails after an unattended merge is the worst state this system can produce,
// and it was silent.
//
// It must fire on a TRANSITION, or every inbox load re-announces every past
// fix — the inbox polls every 8 seconds.
{
  const at = "2026-09-11T12:00:00.000Z";
  const st = (state) => ({ state, checkedAt: at });

  assert.equal(
    shipAnnouncementFor(st(FIX_SHIP_STATE.PR_OPEN), st(FIX_SHIP_STATE.DEPLOYED)),
    "live",
  );
  assert.equal(shipAnnouncementFor(st(FIX_SHIP_STATE.MERGED), st(FIX_SHIP_STATE.DEPLOYED)), "live");
  assert.equal(
    shipAnnouncementFor(null, st(FIX_SHIP_STATE.DEPLOYED)),
    "live",
    "first look already live still counts",
  );
  assert.equal(
    shipAnnouncementFor(st(FIX_SHIP_STATE.MERGED), st(FIX_SHIP_STATE.DEPLOY_FAILED)),
    "deploy_failed",
  );
  assert.equal(
    shipAnnouncementFor(st(FIX_SHIP_STATE.DEPLOYED), st(FIX_SHIP_STATE.DEPLOYED)),
    null,
    "already announced — the inbox polls every 8s, this must stay silent",
  );
  assert.equal(
    shipAnnouncementFor(st(FIX_SHIP_STATE.DEPLOY_FAILED), st(FIX_SHIP_STATE.DEPLOY_FAILED)),
    null,
  );
  assert.equal(
    shipAnnouncementFor(st(FIX_SHIP_STATE.PR_OPEN), st(FIX_SHIP_STATE.MERGED)),
    null,
    "merged is not live",
  );
  assert.equal(shipAnnouncementFor(st(FIX_SHIP_STATE.PR_OPEN), st(FIX_SHIP_STATE.DEPLOYING)), null);
  assert.equal(shipAnnouncementFor(st(FIX_SHIP_STATE.PR_OPEN), null), null);
}

console.log("feedback-ship-announcement: ok");
