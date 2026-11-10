/**
 * One mapper from work.phase to the six canonical statuses
 * (docs/foundation/RUN-STATUS-SSOT.md), read by the status route, Watch and
 * the reporter view.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CANONICAL_CAUSE,
  CANONICAL_STATE,
  canonicalStatus,
} from "../../src/lib/feedback/canonical-status";
import {
  FEEDBACK_WORK_PHASE,
  WAITING_ON,
  type FeedbackWorkView,
} from "../../src/lib/feedback/work-phase";
import { FIX_SHIP_STATE, type FixShipping } from "../../src/lib/feedback/fix-shipping";
import { reporterStatusFor } from "../../src/lib/feedback/reporter-view";

const read = (p: string) => readFileSync(p, "utf8");
const work = (o: Partial<FeedbackWorkView>): FeedbackWorkView => ({
  phase: FEEDBACK_WORK_PHASE.NOT_STARTED,
  waitingOn: WAITING_ON.YOU,
  label: "x",
  detail: null,
  ...o,
});
const ship = (state: FixShipping["state"], o: Partial<FixShipping> = {}): FixShipping => ({
  state,
  checkedAt: "2026-11-10T00:00:00Z",
  ...o,
});
const pr = { number: 7, url: "https://github.com/o/r/pull/7", title: "t", mergeSha: "abc" };
const P = FEEDBACK_WORK_PHASE;
const S = CANONICAL_STATE;
const C = CANONICAL_CAUSE;

const cases: [string, FeedbackWorkView, string, string][] = [
  ["not started", work({}), S.NEEDS_YOU, C.AWAITING_IMPLEMENT],
  ["queued", work({ phase: P.QUEUED, waitingOn: "machine" }), S.QUEUED, C.WAITING_FOR_BUILDER],
  [
    "starting",
    work({ phase: P.QUEUED, waitingOn: "machine", starting: true }),
    S.STARTING,
    C.AGENT_STARTING,
  ],
  ["working", work({ phase: P.WORKING, waitingOn: "machine" }), S.WORKING, C.AGENT_GENERATING],
  ["stuck", work({ phase: P.STUCK }), S.NEEDS_YOU, C.STALLED],
  ["offline", work({ phase: P.STUCK, rerouteTo: "cloud" }), S.NEEDS_YOU, C.BUILDER_OFFLINE],
  ["failed", work({ phase: P.FAILED }), S.FAILED, C.RUN_FAILED],
  [
    "no ledger yet",
    work({ phase: P.NEEDS_VERIFY, waitingOn: "machine" }),
    S.WORKING,
    C.LOOKING_UP_RESULT,
  ],
  [
    "nothing shipped",
    work({ phase: P.NEEDS_VERIFY, ship: ship(FIX_SHIP_STATE.NO_EVIDENCE) }),
    S.NEEDS_YOU,
    C.NOTHING_SHIPPED,
  ],
  [
    "pushed",
    work({ phase: P.NEEDS_VERIFY, ship: ship(FIX_SHIP_STATE.PUSHED) }),
    S.NEEDS_YOU,
    C.PUSHED_NO_PR,
  ],
  [
    "pr open",
    work({
      phase: P.NEEDS_VERIFY,
      waitingOn: "machine",
      ship: ship(FIX_SHIP_STATE.PR_OPEN, { pr }),
    }),
    S.WORKING,
    C.PR_OPEN,
  ],
  [
    "pr closed",
    work({ phase: P.FAILED, ship: ship(FIX_SHIP_STATE.PR_CLOSED, { pr }) }),
    S.FAILED,
    C.PR_CLOSED,
  ],
  [
    "merged",
    work({ phase: P.NEEDS_VERIFY, ship: ship(FIX_SHIP_STATE.MERGED, { pr }) }),
    S.NEEDS_YOU,
    C.MERGED_NO_DEPLOY_SEEN,
  ],
  [
    "deploying",
    work({
      phase: P.NEEDS_VERIFY,
      waitingOn: "machine",
      ship: ship(FIX_SHIP_STATE.DEPLOYING, { pr }),
    }),
    S.WORKING,
    C.DEPLOYING,
  ],
  [
    "deploy failed",
    work({ phase: P.FAILED, ship: ship(FIX_SHIP_STATE.DEPLOY_FAILED, { pr }) }),
    S.FAILED,
    C.DEPLOY_FAILED,
  ],
  [
    "deployed, unconfirmed",
    work({ phase: P.NEEDS_VERIFY, ship: ship(FIX_SHIP_STATE.DEPLOYED, { pr }) }),
    S.NEEDS_YOU,
    C.LIVE_UNCONFIRMED,
  ],
  ["done", work({ phase: P.DONE, waitingOn: "nobody" }), S.DONE, C.CONFIRMED],
  ["archived", work({ phase: P.ARCHIVED, waitingOn: "nobody" }), S.DONE, C.CLOSED_WITHOUT_CHANGE],
];
for (const [name, w, state, cause] of cases) {
  const got = canonicalStatus(w);
  assert.equal(got.state, state, `${name}: state`);
  assert.equal(got.cause, cause, `${name}: cause`);
  assert.ok(got.nextAction.label, `${name}: says what next`);
  assert.equal(got.nextAction.who, w.waitingOn, `${name}: who is the inbox's who`);
}
// Every phase is covered: a new phase fails the type switch and this count.
assert.equal(new Set(cases.map((c) => c[1].phase)).size, Object.keys(P).length);

// Only the six states exist.
assert.deepEqual(Object.values(S).sort(), [
  "done",
  "failed",
  "needs_you",
  "queued",
  "starting",
  "working",
]);

// Evidence is what was seen: a discounted pull request is not evidence.
const live = canonicalStatus(
  work({
    phase: P.NEEDS_VERIFY,
    ship: ship(FIX_SHIP_STATE.DEPLOYED, {
      pr,
      deploy: {
        url: "https://x/run/1",
        name: "Deploy",
        conclusion: "success",
        status: "completed",
      },
      verify: { verdict: "looks_fixed", evidence: "e", at: "t", url: "u" },
    }),
  }),
  { liveUrl: "https://site.example" },
).evidence;
assert.deepEqual(live.pr, { number: 7, url: pr.url });
assert.equal(live.merged && live.deployed, true);
assert.equal(live.mergeSha, "abc");
assert.equal(live.liveUrl, "https://site.example");
assert.equal(live.verified, "looks_fixed");
const foreign = canonicalStatus(
  work({ phase: P.NEEDS_VERIFY, ship: ship(FIX_SHIP_STATE.NO_EVIDENCE, { pr, foreignPr: true }) }),
).evidence;
assert.equal(foreign.pr, null, "a pull request that is not this run's is not evidence");
assert.equal(foreign.merged, false);
const earlier = canonicalStatus(
  work({ phase: P.NEEDS_VERIFY, ship: ship(FIX_SHIP_STATE.PR_OPEN, { pr }) }),
).evidence;
assert.equal(
  earlier.merged || earlier.deployed,
  false,
  "an open PR is neither merged nor deployed",
);

// The reporter reads the same state, and only the state.
const rep = reporterStatusFor(work({ phase: P.WORKING, waitingOn: "machine" }));
assert.equal(rep.state, S.WORKING);
assert.deepEqual(
  Object.keys(rep).filter((k) => ["cause", "nextAction", "evidence"].includes(k)),
  [],
);

// Wiring: the three surfaces call the one mapper.
assert.match(read("src/app/api/feedback/[id]/status/route.ts"), /canonicalStatus\(/);
assert.match(read("src/lib/run-track-load.ts"), /canonicalStatus\(work/);
assert.match(read("src/app/api/projects/[id]/watch/route.ts"), /canonical/);
assert.match(read("src/lib/feedback/reporter-view.ts"), /canonicalStatus\(work\)/);
const route = read("src/app/api/feedback/[id]/status/route.ts");
assert.match(route, /row\.canEdit/, "full status is the owner's and editor's");
assert.match(route, /reporterUserId !== userId/, "a reporter sees only their own report");
// The agent filing route hands out this route as its statusUrl.
assert.match(
  read("src/app/api/projects/[id]/feedback/route.ts"),
  /\/api\/feedback\/\$\{row\.id\}\/status/,
);

console.log("canonical-status ok");
