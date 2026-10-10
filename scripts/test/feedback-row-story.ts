/**
 * The row's two sentences, pinned per phase: what the state IS and what is
 * wanted. Run: npx tsx scripts/test/feedback-row-story.ts
 */
import assert from "node:assert/strict";
import { rowStory, inOwnersWords, LENS_MEANING } from "@/lib/feedback/row-story";
import { FEEDBACK_WORK_PHASE, WAITING_ON, type FeedbackWorkView } from "@/lib/feedback/work-phase";
import { FIX_SHIP_STATE, type FixShipping } from "@/lib/feedback/fix-shipping";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const base = {
  page: "/pricing",
  runnable: true,
  hadRun: true,
  resolvedAt: null,
  archiveReason: null,
};
const work = (over: Partial<FeedbackWorkView>): FeedbackWorkView => ({
  phase: FEEDBACK_WORK_PHASE.NOT_STARTED,
  waitingOn: WAITING_ON.YOU,
  label: "",
  detail: null,
  ...over,
});
const ship = (state: string, over: Partial<FixShipping> = {}): FixShipping =>
  ({ state, checkedAt: new Date(NOW).toISOString(), ...over }) as unknown as FixShipping;

// Not started: the headline says nobody moved, the next line names both doors.
let s = rowStory({ ...base, work: work({}) }, NOW);
assert.equal(s.headline, "Nobody has started on this.");
assert.match(s.next!, /Build it, or file it away/);
s = rowStory({ ...base, runnable: false, work: work({}) }, NOW);
assert.match(s.headline, /nowhere for an agent to work/);

// Moving: nobody is asked for anything, and the sentence says so.
s = rowStory(
  {
    ...base,
    work: work({
      phase: FEEDBACK_WORK_PHASE.QUEUED,
      label: "Queued",
      detail: "Behind “Fix the footer” on this project — starts when that run finishes",
    }),
  },
  NOW,
);
assert.equal(
  s.headline,
  "Waiting its turn — behind “Fix the footer” on this project — starts when that run finishes.",
);
assert.equal(s.tone, "machine");
s = rowStory(
  {
    ...base,
    work: work({
      phase: FEEDBACK_WORK_PHASE.WORKING,
      label: "Working · 4 min",
      since: new Date(NOW - 4 * 60_000).toISOString(),
    }),
  },
  NOW,
);
assert.equal(s.headline, "An agent is working on it — 4 min so far.");

// Stuck / failed: the headline is the fact, the next line is the way out.
s = rowStory(
  {
    ...base,
    work: work({
      phase: FEEDBACK_WORK_PHASE.STUCK,
      label: "Needs you",
      detail: "This computer is offline — the cloud builder can take it now",
      rerouteTo: "cloud",
    }),
  },
  NOW,
);
assert.match(s.headline, /this computer is offline/);
assert.match(s.next!, /Run it in the cloud/);
s = rowStory(
  {
    ...base,
    work: work({
      phase: FEEDBACK_WORK_PHASE.STUCK,
      label: "Needs you to sign in",
      detail: "Sign in on Watch",
    }),
  },
  NOW,
);
assert.match(s.headline, /sign-in prompt/);
s = rowStory(
  {
    ...base,
    work: work({
      phase: FEEDBACK_WORK_PHASE.FAILED,
      label: "Failed",
      detail: "The agent ran out of quota — switch provider, or Retry once it resets.",
    }),
  },
  NOW,
);
assert.equal(s.headline, "The attempt failed.");
assert.match(s.next!, /ran out of quota/);
s = rowStory(
  {
    ...base,
    work: work({
      phase: FEEDBACK_WORK_PHASE.FAILED,
      label: "PR #4 · deploy failed",
      ship: ship(FIX_SHIP_STATE.DEPLOY_FAILED),
    }),
  },
  NOW,
);
assert.match(s.headline, /deploy failed/);

// Live: where, and what is wanted — look, then answer.
s = rowStory(
  {
    ...base,
    work: work({
      phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
      label: "Live — check it",
      checkLive: true,
      ship: ship(FIX_SHIP_STATE.DEPLOYED),
    }),
  },
  NOW,
);
assert.equal(s.headline, "The fix is live on /pricing.");
assert.equal(s.next, "Look at it, then say whether it worked.");
assert.equal(s.tone, "you");
s = rowStory(
  {
    ...base,
    page: "/",
    work: work({
      phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
      label: "Live — check it",
      detail: "The agent reported only partial success — worth a closer look.",
      checkLive: true,
      ship: ship(FIX_SHIP_STATE.DEPLOYED),
    }),
  },
  NOW,
);
assert.equal(s.headline, "The fix is live on the home page.");
assert.match(s.next!, /partial success/);
s = rowStory(
  {
    ...base,
    work: work({
      phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
      label: "PR #4 · open",
      ship: ship(FIX_SHIP_STATE.PR_OPEN),
    }),
  },
  NOW,
);
assert.equal(s.headline, "The change is written and waiting to merge.");
assert.equal(s.tone, "machine");
s = rowStory(
  {
    ...base,
    work: work({
      phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
      label: "Finished · nothing shipped",
      ship: ship(FIX_SHIP_STATE.NO_EVIDENCE),
    }),
  },
  NOW,
);
assert.match(s.headline, /nothing reached the site/);

// Done: when, and whether there is a walkthrough to see.
s = rowStory(
  {
    ...base,
    resolvedAt: new Date(NOW - 14 * 86_400_000).toISOString(),
    work: work({ phase: FEEDBACK_WORK_PHASE.DONE, label: "Done", waitingOn: WAITING_ON.NOBODY }),
  },
  NOW,
);
assert.match(s.headline, /^Fixed — you confirmed it/);
assert.equal(s.next, null);
s = rowStory(
  {
    ...base,
    hadRun: false,
    work: work({ phase: FEEDBACK_WORK_PHASE.DONE, label: "Done", waitingOn: WAITING_ON.NOBODY }),
  },
  NOW,
);
assert.match(s.headline, /without a run/);

// Filed away: the night's reason rides along.
s = rowStory(
  {
    ...base,
    archiveReason: "Nobody started this in 21 days.",
    work: work({
      phase: FEEDBACK_WORK_PHASE.ARCHIVED,
      label: "Archived",
      waitingOn: WAITING_ON.NOBODY,
    }),
  },
  NOW,
);
assert.equal(s.headline, "Filed away.");
assert.equal(s.next, "Nobody started this in 21 days.");

// A borrowed line names the moves the row actually offers.
assert.equal(
  inOwnersWords("The agent ran out of quota — switch provider, or Retry once it resets."),
  "The agent ran out of quota — switch provider, or Try again once it resets.",
);
assert.equal(inOwnersWords("Open Terminal — or Retry"), "Watch in Terminal — or Try again");
assert.equal(
  inOwnersWords("Retry, or Resolve if it was not a code change."),
  "Try again, or Mark done if it was not a code change.",
);
s = rowStory(
  {
    ...base,
    work: work({
      phase: FEEDBACK_WORK_PHASE.STUCK,
      label: "Needs you",
      detail: "Open Terminal — or Retry",
      watchable: true,
    }),
  },
  NOW,
);
assert.equal(s.headline, "The agent went quiet and did not finish.");

assert.ok(LENS_MEANING.needsYou.length > 20 && LENS_MEANING.done.length > 20);
console.log("✓ feedback row story tests passed");
