/**
 * A seat on someone else's project — a Builder's, a client's, a viewer's —
 * is not the owner's engine. What a seat asks for is a SUGGESTION the owner
 * decides on; only the owner's word starts a build on the owner's builder
 * (owner, 2026-10-20: whoever asks pays, with their own engine, in their own
 * builder — docs/architecture/private-builders.md). "Make it live" stays for
 * a change built for the person who asked (`previewFirst`).
 *
 * Until 2026-10-20 a client built at once on a monthly allowance the owner
 * chose, and a Builder built without asking at all. Both ran on the owner's
 * subscription and both are gone; this file used to pin them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { effectiveAutoShip } from "../../src/lib/feedback/auto-ship";
import { askReply, roleGuide, ROLE_LABELS } from "../../src/lib/project-capabilities";
import { reporterStatusFor } from "../../src/lib/feedback/reporter-view";
import { FEEDBACK_WORK_PHASE, type FeedbackWorkView } from "../../src/lib/feedback/work-phase";
import { FIX_SHIP_STATE } from "../../src/lib/feedback/fix-shipping";
import { AUTO_SHIP_HOLD } from "../../src/lib/feedback/auto-ship";
import { composeFeedbackFixPrompt } from "../../src/lib/feedback/compose-dispatch";
import { FEEDBACK_SOURCE, waitsForATap } from "../../src/lib/constants/statuses";

const read = (p: string) => readFileSync(p, "utf8");

// ─── The allowance is gone, everywhere ──────────────────────────────────────
for (const f of [
  "src/lib/feedback/ask-in-loki.ts",
  "src/db/queries/project-access.ts",
  "src/app/api/projects/[id]/members/route.ts",
  "src/components/projects/ProjectMembersPanel.tsx",
  "src/lib/project-capabilities.ts",
  "src/db/queries/project-dossier.ts",
  "src/lib/build-requests/decide.ts",
])
  assert.doesNotMatch(read(f), /client-allowance|monthlyChanges|setOnAllowance/, `${f} is clean`);
assert.doesNotMatch(
  read("src/app/api/projects/[id]/members/route.ts"),
  /export async function PATCH/,
  "nothing left for the owner to ration",
);

// ─── Only the owner's word builds ───────────────────────────────────────────
const ask = read("src/lib/feedback/ask-in-loki.ts");
assert.match(ask, /const owns = access\.role === "owner";/);
assert.match(ask, /if \(!owns\) \{[\s\S]{0,200}notifyFeedbackReceived\(created\)/, "a suggestion");
assert.match(ask, /if \(bumped && !owns\)/, "asking twice never builds");
assert.doesNotMatch(
  ask,
  /previewFirst/,
  "no seat builds here any more, so nothing is preview-first",
);
assert.match(
  ask,
  /: access\.role === "client"\s*\? FEEDBACK_SOURCE\.CLIENT\s*: FEEDBACK_SOURCE\.MEMBER/,
  "a seat's ask is never filed as the owner's word",
);
assert.equal(waitsForATap(FEEDBACK_SOURCE.CLIENT), true);
assert.equal(waitsForATap(FEEDBACK_SOURCE.MEMBER), true, "the night does not build a seat's ask");
assert.equal(
  effectiveAutoShip(null, FEEDBACK_SOURCE.MEMBER),
  null,
  "and the fix does not merge as if the owner said it",
);
const impl = read("src/lib/feedback/implement.ts");
assert.match(impl, /if \(actorUserId !== row\.ownerUserId\)/, "Implement is the owner's tap only");
const holder = read("src/lib/feedback/pass-holder.ts");
assert.match(holder, /return userId === site\.userId;/, "the owner pass is the owner's alone");
assert.doesNotMatch(holder, /canEdit/);
const cap = read("src/lib/feedback/owner-build.ts");
assert.match(cap, /feedback:owner-build:\$\{ownerUserId\}/, "the daily cap guards one engine");
assert.doesNotMatch(read("src/lib/feedback/notify-new.ts"), /notifyBuilderAsked/);
assert.match(read("src/lib/feedback/notify-new.ts"), /FEEDBACK_SOURCE\.MEMBER,/, "announced");

// ─── What a seat is told ────────────────────────────────────────────────────
const base = { owner: "George", site: "bakery.ch" };
for (const role of ["editor", "client", "viewer"] as const) {
  assert.equal(
    askReply(role, { ...base, building: false }),
    "Sent to George. They decide, and you are told when it ships.",
  );
  assert.match(roleGuide(role, base).then, /^George sees it first and decides\./);
  assert.doesNotMatch(ROLE_LABELS[role].help, /builds|allowance|straight to Loki/);
  assert.doesNotMatch(ROLE_LABELS[role].can, /build|live/);
}
assert.match(askReply("owner", { ...base, building: true }), /^Loki is building it now/);

// ─── A change built for the person who asked goes live on their word ────────
const unapproved = { previewFirst: true, liveApprovedAt: null };
const approved = { previewFirst: true, liveApprovedAt: new Date() };
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
  effectiveAutoShip(null, FEEDBACK_SOURCE.CLIENT, { previewFirst: false, liveApprovedAt: null }),
  null,
  "a seat's ask the owner chose to build ships like any other",
);
assert.equal(effectiveAutoShip(null, FEEDBACK_SOURCE.OWNER), true, "the owner's own is unchanged");
assert.match(
  read("src/lib/feedback/attach-work.ts"),
  /readyDraft: item\.previewFirst && !!item\.liveApprovedAt/,
  "the draft is lifted only after their yes",
);
assert.match(
  read("src/lib/feedback/attach-work.ts"),
  /keepDraft: item\.previewFirst && !item\.liveApprovedAt/,
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
  composeFeedbackFixPrompt({ ...field, source: "client", previewFirst: true }, "site"),
  /open it as a DRAFT/,
  "a merge bot cannot put it live first",
);
assert.doesNotMatch(composeFeedbackFixPrompt({ ...field, source: "client" }, "site"), /DRAFT/);

// ─── The change waiting for them ────────────────────────────────────────────
const prOpen = {
  phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
  waitingOn: "you",
  label: "",
  detail: null,
  ship: { state: FIX_SHIP_STATE.PR_OPEN, checkedAt: new Date().toISOString() },
} as unknown as FeedbackWorkView;
const ready = reporterStatusFor(prOpen, {
  client: { previewFirst: true, liveApprovedAt: null, ownerMerges: false },
});
assert.equal(ready.label, "Ready for you");
assert.equal(ready.goLive, true);
const going = reporterStatusFor(prOpen, {
  client: { previewFirst: true, liveApprovedAt: new Date(), ownerMerges: false },
});
assert.equal(going.label, "Going live");
assert.ok(!going.goLive, "said once");
const stuck = reporterStatusFor(
  {
    ...prOpen,
    ship: { ...prOpen.ship!, autoShipHold: AUTO_SHIP_HOLD.NO_CHECKS },
  } as FeedbackWorkView,
  { client: { previewFirst: true, liveApprovedAt: new Date(), ownerMerges: false } },
);
assert.match(stuck.detail, /needs the site's owner to finish it/);
assert.equal(
  reporterStatusFor(prOpen, {
    client: { previewFirst: true, liveApprovedAt: null, ownerMerges: true },
  }).label,
  "Fix on the way",
  "auto-ship OFF: not theirs to give",
);
assert.equal(reporterStatusFor(prOpen).goLive, undefined, "a visitor never sees the button");
const goLive = read("src/lib/feedback/go-live.ts");
assert.match(goLive, /access\?\.role === "client" && feedback\.reporterUserId === userId/);
assert.match(goLive, /if \(!feedback\.previewFirst\)/, "only a change built for them");

console.log("✓ a seat suggests, the owner decides; Make it live stays");
