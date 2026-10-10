// "Your changes": the loop closing on the owner's own site. The panel's story
// used to end at "On it — Loki tells you when", and on the site Loki never
// did. Pinned here: the owner's words per phase come from the same honest
// phase the inbox uses and say nothing an engineer wrote; the widget
// announces exactly the transition to live, once, and never on first sight;
// the route answers only to a pass for this project and this owner; and the
// receipt's "Follow the build" no longer tours a page that has not changed.
// Run: npx tsx scripts/test/widget-changes.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ownerStatusFor, OWNER_CHANGES_MAX } from "@/lib/feedback/owner-view";
import { FEEDBACK_WORK_PHASE, WAITING_ON, type FeedbackWorkView } from "@/lib/feedback/work-phase";
import { FIX_SHIP_STATE, type FixShipping } from "@/lib/feedback/fix-shipping";
import {
  CHANGES_MAX,
  changesSummary,
  newlyLive,
  parseChanges,
  toSeen,
  type OwnerChange,
} from "../../widget/changes";

const view = (
  phase: FeedbackWorkView["phase"],
  extra: Partial<FeedbackWorkView> = {},
): FeedbackWorkView => ({
  phase,
  waitingOn: WAITING_ON.NOBODY,
  label: "x",
  detail: "Open Fleet Runner on This computer",
  diagnostic: "TypeError: cannot read properties of undefined",
  runId: "run-1",
  ...extra,
});
const ship = (state: string): FixShipping => ({ state }) as FixShipping;

// ---- the owner's words, per phase ----
{
  const waiting = ownerStatusFor(view(FEEDBACK_WORK_PHASE.NOT_STARTED));
  assert.equal(waiting.label, "Waiting");
  assert.ok(waiting.needsYou && !waiting.live && !waiting.settled);
  assert.equal(ownerStatusFor(view(FEEDBACK_WORK_PHASE.QUEUED)).label, "Starting");
  // Behind another change in the project's one lane: the order is the news.
  const behind = ownerStatusFor(
    view(FEEDBACK_WORK_PHASE.QUEUED, {
      detail: "Behind “Add alt text” on this project — starts when that run finishes",
    }),
  );
  assert.equal(behind.label, "In line");
  assert.match(behind.detail, /^Behind “Add alt text”/);
  assert.equal(ownerStatusFor(view(FEEDBACK_WORK_PHASE.WORKING)).label, "Building");
  for (const p of [FEEDBACK_WORK_PHASE.STUCK, FEEDBACK_WORK_PHASE.FAILED]) {
    const s = ownerStatusFor(view(p));
    assert.equal(s.label, "Needs you");
    assert.equal(s.tone, "warning");
    assert.ok(s.needsYou, "the owner is sent into Loki, where the why is");
  }
  for (const st of [
    FIX_SHIP_STATE.PUSHED,
    FIX_SHIP_STATE.PR_OPEN,
    FIX_SHIP_STATE.MERGED,
    FIX_SHIP_STATE.DEPLOYING,
  ]) {
    const s = ownerStatusFor(view(FEEDBACK_WORK_PHASE.NEEDS_VERIFY, { ship: ship(st) }));
    assert.equal(s.label, "On its way", st);
    assert.ok(!s.live && !s.settled);
  }
  const live = ownerStatusFor(
    view(FEEDBACK_WORK_PHASE.NEEDS_VERIFY, { ship: ship(FIX_SHIP_STATE.DEPLOYED) }),
  );
  assert.equal(live.label, "Live");
  assert.ok(live.live && live.settled, "live is the end of the road for the widget");
  const checkLive = ownerStatusFor(view(FEEDBACK_WORK_PHASE.NEEDS_VERIFY, { checkLive: true }));
  assert.ok(checkLive.live, "no deploy we can see, but the reader has to look: counts as live");
  const closedPr = ownerStatusFor(
    view(FEEDBACK_WORK_PHASE.NEEDS_VERIFY, { ship: ship(FIX_SHIP_STATE.PR_CLOSED) }),
  );
  assert.equal(closedPr.label, "Checking");
  assert.ok(!closedPr.live, "a PR closed without merging is not a fix that shipped");
  assert.ok(ownerStatusFor(view(FEEDBACK_WORK_PHASE.DONE)).live);
  const closed = ownerStatusFor(view(FEEDBACK_WORK_PHASE.ARCHIVED));
  assert.ok(closed.settled && !closed.live);
  // Nothing the operator's view carries reaches the site.
  for (const p of Object.values(FEEDBACK_WORK_PHASE)) {
    const s = ownerStatusFor(view(p));
    for (const leak of ["Fleet Runner", "TypeError", "run-1", "dispatched"]) {
      assert.ok(!s.detail.includes(leak) && !s.label.includes(leak), `${p}: "${leak}" leaked`);
    }
  }
}

// ---- the widget notices exactly the transition to live ----
{
  const c = (id: string, live: boolean): OwnerChange => ({
    id,
    text: id,
    at: "",
    label: live ? "Live" : "Building",
    tone: "accent",
    detail: "",
    live,
    settled: live,
    href: null,
    action: null,
  });
  assert.deepEqual(
    newlyLive({}, [c("a", true)]),
    [],
    "first sight of a live change is not an announcement",
  );
  assert.deepEqual(
    newlyLive({ a: false }, [c("a", true)]).map((x) => x.id),
    ["a"],
    "seen building, now live: announce",
  );
  assert.deepEqual(newlyLive({ a: true }, [c("a", true)]), [], "already announced");
  assert.deepEqual(newlyLive({ a: false }, [c("a", false)]), [], "still building");
  assert.deepEqual(toSeen([c("a", true), c("b", false)]), { a: true, b: false });
}

// ---- what the widget accepts from the server ----
{
  const parsed = parseChanges({
    changes: [
      {
        id: "1",
        text: "Add a scene",
        label: "Live",
        tone: "positive",
        live: true,
        settled: true,
        href: "https://heidi.test/x#loki-tour=t",
        action: "See it",
        at: "2026-10-09T10:00:00Z",
        detail: "d",
      },
      { id: "2", text: "x", label: "Building", tone: "weird", href: "javascript:alert(1)" },
      { nope: true },
      "junk",
    ],
  });
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].action, "See it");
  assert.equal(parsed[1].tone, "neutral", "an unknown tone falls back");
  assert.equal(parsed[1].href, null, "only http(s) links become links");
  assert.deepEqual(parseChanges(null), []);
  assert.equal(CHANGES_MAX, OWNER_CHANGES_MAX, "the widget's cap mirrors the server's");
}

// ---- the route and the receipt link ----
const route = readFileSync("src/app/api/widget/owner/changes/route.ts", "utf8");
assert.match(route, /verifyOwnerPass\(data\.ownerPass\)/, "a pass, verified");
assert.match(
  route,
  /pass\.projectId !== token\.projectId \|\| pass\.userId !== token\.userId/,
  "for this project and owner",
);
assert.match(
  route,
  /owner: false, changes: \[\]/,
  "no pass, nothing — a stranger with the public token learns nothing",
);
assert.match(
  route,
  /attachFeedbackWork\(token\.userId, \[\s*\.\.\.mine/,
  "the same phase the inbox derives",
);
assert.match(
  route,
  /i\.source === FEEDBACK_SOURCE\.OWNER \|\| i\.source === FEEDBACK_SOURCE\.AI_REVIEW/,
  "yours means yours — a visitor's note is not the owner's change",
);
assert.match(route, /visitors/, "and visitors' notes are counted, not listed");
assert.match(route, /isWidgetOriginAllowed/, "origin allowlist like every widget route");
assert.match(
  route,
  /createTourToken\(item\.id\)/,
  "See it is the walkthrough of this change, for the owner",
);
const watchFix = readFileSync("src/app/(app)/feedback/[id]/watch-fix/route.ts", "utf8");
assert.match(
  watchFix,
  /if \(!status\.live\) return projectInbox;/,
  "no walkthrough of a change that is not there yet",
);
const ingest = readFileSync("src/app/api/feedback/route.ts", "utf8");
assert.match(
  ingest,
  /duplicateOf: bumped, \.\.\.build, followUrl/,
  "the owner's repeated note keeps its follow link",
);
const main = readFileSync("widget/main.ts", "utf8");
assert.match(main, /is live on this site\./, "Loki says it in the thread");
assert.match(main, /launcher\.say\(/, "and beside the launcher when the panel is closed");
assert.match(main, /changes\.start\(\)/, "asked for on arrival");

// ---- the collapsed line says what moves and what landed, in that order ----
{
  const c = (label: string, live = false) =>
    ({
      id: label,
      text: label,
      at: "",
      label,
      tone: "neutral",
      detail: "",
      live,
      settled: live,
      href: null,
      action: null,
    }) as OwnerChange;
  assert.equal(
    changesSummary([c("Building"), c("In line"), c("In line"), c("Live", true), c("Done", true)]),
    "Your changes · 1 building · 2 in line · 2 live",
  );
  assert.equal(
    changesSummary([c("Needs you"), c("Live", true)]),
    "Your changes · 1 needs you · 1 live",
  );
  assert.equal(changesSummary([c("Closed")]), "Your changes · 1");
}

console.log("widget-changes: ok");
