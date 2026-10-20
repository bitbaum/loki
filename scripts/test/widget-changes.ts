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
import { ownerStatusFor, ownerTap, OWNER_CHANGES_MAX } from "@/lib/feedback/owner-view";
import { FEEDBACK_WORK_PHASE, WAITING_ON, type FeedbackWorkView } from "@/lib/feedback/work-phase";
import { FIX_SHIP_STATE, type FixShipping } from "@/lib/feedback/fix-shipping";
import {
  CHANGES_MAX,
  builtSay,
  changesHeadline,
  SAVED_NOTE_LABEL,
  changesSummary,
  needsYouCount,
  newlyLive,
  parseChanges,
  parseNeedsYou,
  shownChanges,
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
    // …by a link, not a sentence telling them to go (2026-10-20): the run's
    // Watch page when there is a run, the inbox when there is none.
    assert.doesNotMatch(s.detail, /Open it in Loki/, "the way in is the link, not the words");
    assert.deepEqual(ownerTap(s, true), { to: "run", action: "Open it in Loki to see why" });
    assert.equal(ownerTap(s, false).to, "inbox");
  }
  assert.deepEqual(ownerTap(ownerStatusFor(view(FEEDBACK_WORK_PHASE.WORKING)), true), {
    to: "run",
    action: "Watch it",
  });
  assert.equal(ownerTap(ownerStatusFor(view(FEEDBACK_WORK_PHASE.QUEUED)), false).to, null);
  assert.deepEqual(ownerTap(ownerStatusFor(view(FEEDBACK_WORK_PHASE.DONE)), true), {
    to: "live",
    action: "See it",
  });
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
    needsYou: false,
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
  assert.equal(parsed[0].needsYou, false, "waits on the owner only when the server says so");
  assert.equal(
    parseChanges({ changes: [{ id: "3", text: "y", label: "Needs you", needsYou: true }] })[0]
      .needsYou,
    true,
  );
  assert.equal(parseNeedsYou({ needsYou: 14 }), 14, "the server's count, past the twelve rows");
  assert.equal(parseNeedsYou({ needsYou: "9" }), 0);
  assert.equal(parseNeedsYou(null), 0);
  assert.deepEqual(parseChanges(null), []);
  assert.equal(CHANGES_MAX, OWNER_CHANGES_MAX, "the widget's cap mirrors the server's");
}

// ---- the route and the receipt link ----
const route = readFileSync("src/app/api/widget/owner/changes/route.ts", "utf8");
const ownerCheck = readFileSync("src/lib/widget/owner-request.ts", "utf8");
assert.match(route, /ownerRequest\(req, data\)/, "a pass, verified");
assert.match(ownerCheck, /passHolder\(data\.ownerPass, token\)/, "…by passHolder");
assert.match(
  readFileSync("src/lib/feedback/pass-rule.ts", "utf8"),
  /pass\.projectId !== site\.projectId\) return false/,
  "for this project, its owner or an editor (scripts/test/widget-pass-holder.ts)",
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
assert.match(ownerCheck, /isWidgetOriginAllowed/, "origin allowlist like every widget route");
assert.match(
  route,
  /createTourToken\(item\.id\)/,
  "See it is the walkthrough of this change, for the owner",
);
const watchFix = readFileSync("src/app/(app)/feedback/[id]/watch-fix/route.ts", "utf8");
assert.match(
  watchFix,
  /if \(!status\.live\) \{(?:(?!tourSiteUrl)[\s\S])*?\/watch\?run=(?:(?!tourSiteUrl)[\s\S])*?return projectInbox;\s*\}/,
  "no walkthrough of a change that is not there yet — its live run, or the inbox",
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
      // What the server marks as waiting on the owner (owner-view.ts).
      needsYou: ["Needs you", SAVED_NOTE_LABEL, "Waiting"].includes(label),
    }) as OwnerChange;
  assert.equal(
    changesSummary([c("Building"), c("In line"), c("In line"), c("Live", true), c("Done", true)]),
    "Your changes · 1 building · 2 in line · 2 live",
  );
  assert.equal(
    changesSummary([c("Needs you"), c("Live", true)]),
    "Your changes · 1 needs you · 1 live",
  );
  assert.equal(
    changesSummary([c("Needs you"), c(SAVED_NOTE_LABEL), c("On its way")]),
    "Your changes · 2 need you · 1 on its way",
    "the open list agrees with the line above it (it said '9 needs you', 2026-10-18)",
  );
  assert.equal(changesSummary([c("Closed")]), "Your changes · 1");
  // The line carries ONE number: what waits on the owner's decision —
  // failed attempts, saved notes, notes not started, and changes said but
  // not saved. Nothing waiting: nothing on the line ("Watching" alone).
  assert.equal(
    changesHeadline([c("Live", true), c("Needs you"), c("Building")]),
    "1 change needs you",
  );
  assert.equal(
    changesHeadline([c("Needs you"), c(SAVED_NOTE_LABEL), c("Waiting")]),
    "3 changes need you",
    "a saved note and one not started wait on the owner too",
  );
  assert.equal(changesHeadline([c("Live", true), c("Starting"), c("Building")]), "");
  assert.equal(changesHeadline([c("Live", true), c("Live", true)]), "");
  assert.equal(changesHeadline([c("On its way")]), "");
  assert.equal(changesHeadline([c("Closed")]), "", "nothing to say: nothing on the line");
  assert.equal(
    changesHeadline([c("Live", true)], { unsaved: 3 }),
    "3 changes need you",
    "changes said on the card and not saved yet are waiting on the owner",
  );
  // The server counts past the twelve rows it sends; the line follows it.
  // Counting inside the newest twelve let three fresh notes push three
  // failed fixes out — "9 need you" became 6 with nothing done (2026-10-20).
  assert.equal(changesHeadline([c("Needs you")], { total: 9 }), "9 changes need you");
  assert.equal(needsYouCount([c("Needs you"), c("Needs you")], { total: 9, unsaved: 1 }), 10);
  // The open list shows every row the line counts, first.
  const many = [
    c("Live", true),
    c("Building"),
    c("Needs you"),
    c("On its way"),
    c(SAVED_NOTE_LABEL),
    c("Needs you"),
  ];
  const shown = shownChanges(many);
  assert.deepEqual(
    shown.slice(0, 3).map((x) => x.label),
    ["Needs you", SAVED_NOTE_LABEL, "Needs you"],
    "every row that needs the owner leads the list",
  );
  assert.equal(shown.length, 3, "and the rest fill up to CHANGES_SHOWN, no more");
  assert.equal(
    shownChanges([c("Needs you"), c("Needs you"), c("Needs you"), c("Needs you"), c("Live", true)])
      .length,
    4,
    "never fewer rows than the line counts",
  );
  assert.match(builtSay({ started: 3, total: 3 }), /Started your 3 saved notes/);
  assert.match(
    builtSay({ started: 5, total: 5, builds: 2 }),
    /5 saved notes as 2 builds, one per page/,
  );
  assert.match(
    builtSay({ started: 3, total: 3, builds: 1 }),
    /as one build — they are all about the same page/,
  );
  assert.match(
    builtSay({ started: 1, total: 3, note: "Limit reached." }),
    /Started 1 of 3.*Limit reached/,
  );
  assert.equal(builtSay({ started: 0, total: 0 }), "There are no saved notes waiting.");
  // The widget's word for a saved note is the server's.
  assert.ok(
    readFileSync("src/lib/feedback/owner-view.ts", "utf8").includes(`label: "${SAVED_NOTE_LABEL}"`),
    "owner-view labels a saved note exactly as the widget counts it",
  );
}

console.log("widget-changes: ok");
