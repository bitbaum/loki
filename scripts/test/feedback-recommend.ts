/**
 * Loki's one recommended tap per report, pinned per phase; and what "Do all"
 * says it will do. Run: npx tsx scripts/test/feedback-recommend.ts
 */
import assert from "node:assert/strict";
import {
  RECOMMEND,
  recommendFor,
  summarizeDecisions,
  doAllLabel,
  looksLine,
  staleAfterDays,
} from "@/lib/feedback/recommend";
import { FEEDBACK_WORK_PHASE, WAITING_ON, type FeedbackWorkView } from "@/lib/feedback/work-phase";
import { FIX_SHIP_STATE, type FixShipping } from "@/lib/feedback/fix-shipping";
import { FEEDBACK_SOURCE, FEEDBACK_STATUS } from "@/lib/constants/statuses";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const work = (over: Partial<FeedbackWorkView>): FeedbackWorkView => ({
  phase: FEEDBACK_WORK_PHASE.NOT_STARTED,
  waitingOn: WAITING_ON.YOU,
  label: "",
  detail: null,
  ...over,
});
const ship = (state: string, over: Partial<FixShipping> = {}) =>
  ({ state, ...over }) as unknown as FixShipping;
const seen = (verdict: "looks_fixed" | "not_visible" | "cannot_tell", evidence: string) => ({
  verify: { verdict, evidence, at: new Date(NOW).toISOString(), url: "https://x/pricing" },
});
const base = {
  status: FEEDBACK_STATUS.NEW,
  source: FEEDBACK_SOURCE.VISITOR as string | null,
  createdAt: daysAgo(1),
  duplicateCount: 1,
  runnable: true,
  page: "/pricing",
};

// A fresh visitor report on a runnable project: build it (one run).
let r = recommendFor({ ...base, work: work({}) }, NOW)!;
assert.equal(r.kind, RECOMMEND.BUILD);
assert.equal(r.runs, 1);
assert.match(r.why, /visitor's report on \/pricing/);

// Nobody touched it for three weeks: file it away, free, with the reason.
r = recommendFor({ ...base, createdAt: daysAgo(25), work: work({}) }, NOW)!;
assert.equal(r.kind, RECOMMEND.FILE);
assert.equal(r.runs, 0);
assert.match(r.archiveReason!, /25 days/);
// Loki's own findings go stale in a week; the owner's own notes never do.
assert.equal(staleAfterDays(FEEDBACK_SOURCE.AI_REVIEW), 7);
r = recommendFor(
  { ...base, source: FEEDBACK_SOURCE.AI_REVIEW, createdAt: daysAgo(8), work: work({}) },
  NOW,
)!;
assert.equal(r.kind, RECOMMEND.FILE);
r = recommendFor(
  { ...base, source: FEEDBACK_SOURCE.OWNER, createdAt: daysAgo(40), work: work({}) },
  NOW,
)!;
assert.equal(r.kind, RECOMMEND.BUILD, "the owner's own note is never filed away unasked");

// Nowhere to run: a link, not a tap.
r = recommendFor({ ...base, runnable: false, work: work({}) }, NOW)!;
assert.equal(r.kind, RECOMMEND.CONNECT);

// Moving: no decision.
assert.equal(
  recommendFor(
    {
      ...base,
      status: FEEDBACK_STATUS.DISPATCHED,
      work: work({ phase: FEEDBACK_WORK_PHASE.WORKING, waitingOn: WAITING_ON.MACHINE }),
    },
    NOW,
  ),
  null,
);
assert.equal(
  recommendFor(
    {
      ...base,
      status: FEEDBACK_STATUS.DISPATCHED,
      work: work({ phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY, ship: ship(FIX_SHIP_STATE.PR_OPEN) }),
    },
    NOW,
  ),
  null,
);
assert.equal(
  recommendFor(
    {
      ...base,
      status: FEEDBACK_STATUS.DISPATCHED,
      work: work({
        phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
        ship: ship(FIX_SHIP_STATE.MERGED),
        checkLive: true,
      }),
    },
    NOW,
  ),
  null,
  "merged waits for the deploy",
);

// Live and Loki read the page and found the change: close it, free, the
// surest decision there is — and the reason is what Loki saw.
r = recommendFor(
  {
    ...base,
    status: FEEDBACK_STATUS.DISPATCHED,
    work: work({
      phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
      ship: ship(FIX_SHIP_STATE.DEPLOYED, seen("looks_fixed", "The footer now reads “© 2026”.")),
      checkLive: true,
    }),
  },
  NOW,
)!;
assert.equal(r.kind, RECOMMEND.CONFIRM);
assert.equal(r.label, "Close it");
assert.match(r.why, /Loki checked \/pricing: The footer now reads/);
assert.equal(r.runs, 0);
assert.ok(r.priority > 40);
// Loki read it and the change is not there: a second run, not a person's eyes.
r = recommendFor(
  {
    ...base,
    status: FEEDBACK_STATUS.DISPATCHED,
    work: work({
      phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
      ship: ship(FIX_SHIP_STATE.DEPLOYED, seen("not_visible", "The footer still says 2024.")),
      checkLive: true,
    }),
  },
  NOW,
)!;
assert.equal(r.kind, RECOMMEND.RETRY);
assert.match(r.why, /could not find the change: The footer still says 2024/);
// Live but unread, or unreadable from text: the owner's eyes — never "confirm" blind.
r = recommendFor(
  {
    ...base,
    status: FEEDBACK_STATUS.DISPATCHED,
    work: work({
      phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
      ship: ship(FIX_SHIP_STATE.DEPLOYED),
      checkLive: true,
    }),
  },
  NOW,
)!;
assert.equal(r.kind, RECOMMEND.LOOK);
assert.equal(r.runs, 0);
r = recommendFor(
  {
    ...base,
    status: FEEDBACK_STATUS.DISPATCHED,
    work: work({
      phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
      ship: ship(
        FIX_SHIP_STATE.DEPLOYED,
        seen("cannot_tell", "Text cannot show whether the cards fit on one row."),
      ),
      checkLive: true,
    }),
  },
  NOW,
)!;
assert.equal(r.kind, RECOMMEND.LOOK);
assert.match(r.why, /cards fit on one row/);
// Live but the agent said "partial": not a confirm — a second run.
r = recommendFor(
  {
    ...base,
    status: FEEDBACK_STATUS.DISPATCHED,
    work: work({
      phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
      ship: ship(FIX_SHIP_STATE.DEPLOYED),
      checkLive: true,
      detail: "The agent reported only partial success — worth a closer look.",
    }),
  },
  NOW,
)!;
assert.equal(r.kind, RECOMMEND.RETRY);

// Stuck on a shut laptop with the cloud up: move it.
r = recommendFor(
  {
    ...base,
    status: FEEDBACK_STATUS.DISPATCHED,
    work: work({ phase: FEEDBACK_WORK_PHASE.STUCK, rerouteTo: "cloud" }),
  },
  NOW,
)!;
assert.equal(r.kind, RECOMMEND.CLOUD);
// Failed: try again. A closed pull request: file away.
r = recommendFor(
  {
    ...base,
    status: FEEDBACK_STATUS.DISPATCHED,
    work: work({
      phase: FEEDBACK_WORK_PHASE.FAILED,
      detail: "The agent ran out of quota — switch provider, or Retry once it resets.",
    }),
  },
  NOW,
)!;
assert.equal(r.kind, RECOMMEND.RETRY);
r = recommendFor(
  {
    ...base,
    status: FEEDBACK_STATUS.DISPATCHED,
    work: work({ phase: FEEDBACK_WORK_PHASE.FAILED, ship: ship(FIX_SHIP_STATE.PR_CLOSED) }),
  },
  NOW,
)!;
assert.equal(r.kind, RECOMMEND.FILE);

// Done and archived rows carry no decision.
assert.equal(
  recommendFor(
    { ...base, status: FEEDBACK_STATUS.RESOLVED, work: work({ phase: FEEDBACK_WORK_PHASE.DONE }) },
    NOW,
  ),
  null,
);

// "Do all" says what it spends before it is tapped; a Connect is not counted,
// and a Look is left for the owner's eyes and said so.
const s = summarizeDecisions([
  recommendFor({ ...base, work: work({}) }, NOW)!,
  recommendFor({ ...base, createdAt: daysAgo(25), work: work({}) }, NOW)!,
  recommendFor(
    {
      ...base,
      status: FEEDBACK_STATUS.DISPATCHED,
      work: work({
        phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
        ship: ship(FIX_SHIP_STATE.DEPLOYED, seen("looks_fixed", "ok")),
        checkLive: true,
      }),
    },
    NOW,
  )!,
  recommendFor(
    {
      ...base,
      status: FEEDBACK_STATUS.DISPATCHED,
      work: work({
        phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
        ship: ship(FIX_SHIP_STATE.DEPLOYED),
        checkLive: true,
      }),
    },
    NOW,
  )!,
  recommendFor({ ...base, runnable: false, work: work({}) }, NOW)!,
]);
assert.deepEqual(s, { total: 5, runs: 1, confirms: 1, files: 1, looks: 1, takeable: 3 });
assert.equal(doAllLabel(s), "Do all 3 · starts 1 run, closes 1, files 1 away");
assert.equal(looksLine(s), "1 is live and needs your eyes — Loki could not tell from the page.");

console.log("✓ feedback recommend tests passed");
