/**
 * The client's seat: what they ask builds at once on a monthly allowance the
 * owner chose, each change waits for their "Make it live", and past the
 * allowance the owner decides (owner, 2026-10-19).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  allowanceChoiceId,
  allowanceMonthStart,
  changesLeft,
  CLIENT_ALLOWANCE_CHOICES,
  CLIENT_ALLOWANCE_VALUES,
  DEFAULT_CLIENT_ALLOWANCE,
} from "../../src/config/client-allowance";
import { effectiveAutoShip } from "../../src/lib/feedback/auto-ship";
import { askReply, roleGuide, ROLE_LABELS } from "../../src/lib/project-capabilities";
import { reporterStatusFor } from "../../src/lib/feedback/reporter-view";
import { FEEDBACK_WORK_PHASE, type FeedbackWorkView } from "../../src/lib/feedback/work-phase";
import { FIX_SHIP_STATE } from "../../src/lib/feedback/fix-shipping";
import { AUTO_SHIP_HOLD } from "../../src/lib/feedback/auto-ship";
import { composeFeedbackFixPrompt } from "../../src/lib/feedback/compose-dispatch";
import { FEEDBACK_SOURCE, waitsForATap } from "../../src/lib/constants/statuses";

const read = (p: string) => readFileSync(p, "utf8");

// ─── The owner's choice ─────────────────────────────────────────────────────
assert.equal(CLIENT_ALLOWANCE_CHOICES[0].value, null, "Ask me first is a choice, listed first");
assert.ok(CLIENT_ALLOWANCE_VALUES.includes(DEFAULT_CLIENT_ALLOWANCE as number));
for (const c of CLIENT_ALLOWANCE_CHOICES)
  assert.ok(c.means.length > 0, `${c.id} says what it means`);
assert.equal(allowanceChoiceId(null), "ask");
assert.equal(allowanceChoiceId(20), "20");
assert.equal(allowanceChoiceId(7), "ask", "an unknown number reads as the safe choice");
assert.equal(changesLeft(null, 3), null, "no allowance, nothing to count");
assert.equal(changesLeft(20, 3), 17);
assert.equal(changesLeft(5, 9), 0, "never negative");
assert.equal(
  allowanceMonthStart(new Date("2026-10-19T23:59:00Z")).toISOString(),
  "2026-10-01T00:00:00.000Z",
);
const members = read("src/app/api/projects/[id]/members/route.ts");
assert.match(
  members,
  /CLIENT_ALLOWANCE_VALUES\.includes\(n\)/,
  "only the offered numbers are accepted",
);
assert.match(members, /export async function PATCH/, "the owner can change it later");

// ─── A change on the allowance goes live on the client's word ───────────────
const unapproved = { onAllowance: true, liveApprovedAt: null };
const approved = { onAllowance: true, liveApprovedAt: new Date() };
assert.equal(
  effectiveAutoShip(true, FEEDBACK_SOURCE.CLIENT, unapproved),
  false,
  "never before they say so",
);
assert.equal(effectiveAutoShip(null, FEEDBACK_SOURCE.CLIENT, approved), true, "on their word");
assert.equal(
  effectiveAutoShip(false, FEEDBACK_SOURCE.CLIENT, approved),
  false,
  "OFF: the owner merges",
);
assert.equal(
  effectiveAutoShip(null, FEEDBACK_SOURCE.CLIENT, { onAllowance: false, liveApprovedAt: null }),
  null,
  "a client's ask the owner chose to build ships like any other",
);
assert.equal(effectiveAutoShip(null, FEEDBACK_SOURCE.OWNER), true, "the owner's own is unchanged");
assert.match(
  read("src/lib/feedback/attach-work.ts"),
  /readyDraft: item\.onAllowance && !!item\.liveApprovedAt/,
  "the draft is lifted only after their yes",
);
assert.match(
  read("src/lib/feedback/attach-work.ts"),
  /keepDraft: item\.onAllowance && !item\.liveApprovedAt/,
  "until then, a pull request opened as ready is put back into draft",
);
assert.match(
  read("src/lib/feedback/fix-shipping-refresh.ts"),
  /input\.keepDraft &&[\s\S]{0,200}prOpenedByRun\(pr\.createdAt, input\.runStartedAt\)[\s\S]{0,40}setDraft\(pr\.nodeId, picked\.token, true\)/,
  "and only one this run opened",
);
assert.match(read("src/lib/feedback/recommend.ts"), /CLIENT\) return "Your client's request"/);
const field = {
  suggestion: "Bigger logo",
  duplicateCount: 1,
  url: null,
  page: "/",
  scope: null,
  selectedElements: null,
};
assert.match(
  composeFeedbackFixPrompt({ ...field, source: "client", onAllowance: true }, "site"),
  /open it as a DRAFT/,
  "a merge bot cannot put it live first",
);
assert.doesNotMatch(composeFeedbackFixPrompt({ ...field, source: "client" }, "site"), /DRAFT/);

// ─── What the client is told ────────────────────────────────────────────────
const base = { owner: "George", site: "bakery.ch" };
assert.match(
  askReply("client", {
    ...base,
    building: true,
    allowance: { limit: 20, left: 17 },
    waitsForYes: true,
  }),
  /asked to make it live\. 17 of 20 changes left this month\./,
);
assert.match(
  askReply("client", { ...base, building: true, allowance: { limit: 20, left: 17 } }),
  /you will see it on bakery\.ch/,
  "a preview folder has no live site to wait for",
);
assert.match(
  askReply("client", { ...base, building: false, allowance: { limit: 20, left: 0 } }),
  /^Sent to George\. You have used this month's 20 changes, so George decides/,
);
assert.match(
  askReply("client", { ...base, building: false, allowance: { limit: 20, left: 4 } }),
  /did not count against your changes/,
);
assert.match(askReply("client", { ...base, building: false }), /^Sent to George\. They decide/);
assert.match(
  roleGuide("client", base, { limit: 5, left: 5 }).then,
  /goes live when you say so\. 5 of 5/,
);
assert.match(roleGuide("client", base).then, /George sees it first/);
assert.doesNotMatch(
  ROLE_LABELS.client.can,
  /build|live/,
  "the invite email is true for every allowance",
);

// ─── The change waiting for them ────────────────────────────────────────────
const prOpen = {
  phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
  waitingOn: "you",
  label: "",
  detail: null,
  ship: { state: FIX_SHIP_STATE.PR_OPEN, checkedAt: new Date().toISOString() },
} as unknown as FeedbackWorkView;
const ready = reporterStatusFor(prOpen, {
  client: { onAllowance: true, liveApprovedAt: null, ownerMerges: false },
});
assert.equal(ready.label, "Ready for you");
assert.equal(ready.goLive, true);
const going = reporterStatusFor(prOpen, {
  client: { onAllowance: true, liveApprovedAt: new Date(), ownerMerges: false },
});
assert.equal(going.label, "Going live");
assert.ok(!going.goLive, "said once");
const stuck = reporterStatusFor(
  {
    ...prOpen,
    ship: { ...prOpen.ship!, autoShipHold: AUTO_SHIP_HOLD.NO_CHECKS },
  } as FeedbackWorkView,
  { client: { onAllowance: true, liveApprovedAt: new Date(), ownerMerges: false } },
);
assert.match(stuck.detail, /needs the site's owner to finish it/);
assert.equal(
  reporterStatusFor(prOpen, {
    client: { onAllowance: true, liveApprovedAt: null, ownerMerges: true },
  }).label,
  "Fix on the way",
  "auto-ship OFF: not theirs to give",
);
assert.equal(reporterStatusFor(prOpen).goLive, undefined, "a visitor never sees the button");

// ─── The asks, and who may say yes ──────────────────────────────────────────
const ask = read("src/lib/feedback/ask-in-loki.ts");
assert.match(ask, /onAllowance: !access\.canEdit && builds,/, "counted before the build reads it");
assert.match(
  ask,
  /if \(created\?\.onAllowance && !build\.building\) await setOnAllowance\(id, false\);/,
  "a build that did not start costs the client nothing",
);
assert.match(ask, /if \(bumped && !access\.canEdit\)/, "asking twice never builds twice");
const goLive = read("src/lib/feedback/go-live.ts");
assert.match(goLive, /access\?\.role === "client" && feedback\.reporterUserId === userId/);
assert.match(goLive, /if \(!feedback\.onAllowance\)/, "only a change built on their allowance");
assert.equal(waitsForATap(FEEDBACK_SOURCE.CLIENT), true, "past the allowance, the night waits too");

console.log("✓ client seat: allowance, Make it live, words, who decides");
