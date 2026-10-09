// What no-screen mode SAYS about the fleet: the briefing leads with what needs
// the person, says "nothing" when there is nothing, and the diff between two
// snapshots announces only what changed — bounded, so a phone reconnecting
// after an hour does not read out the whole day.
import assert from "node:assert/strict";
import { NO_SCREEN_MAX_ANNOUNCEMENTS } from "../../src/config/no-screen";
import {
  composeBriefing,
  composeFailures,
  composeHelp,
  composeWaiting,
  count,
  diffSnapshots,
  excerptForSpeech,
  list,
  type FleetSnapshot,
} from "../../src/lib/voice/briefing";

const empty = (): FleetSnapshot => ({
  at: "2026-10-09T10:00:00.000Z",
  builderOnline: true,
  projects: ["heidi", "orangecat"],
  working: [],
  waitingForBuilder: [],
  recentRuns: [],
  alerts: [],
  approvals: [],
  approvalsLocked: false,
});

let n = 0;
const check = (fn: () => void) => {
  fn();
  n++;
};

check(() => {
  assert.equal(count(0, "run"), "no runs");
  assert.equal(count(1, "run"), "one run");
  assert.equal(count(3, "agent is", "agents are"), "three agents are");
  assert.equal(count(14, "thing"), "14 things");
  assert.equal(list(["a"]), "a");
  assert.equal(list(["a", "b", "c"]), "a, b and c");
});

check(() => {
  // Markdown is flattened and the cut lands on a sentence end.
  const long =
    "## Done\n\nFixed the **header**. Then rewrote the whole menu so it fits. " + "x".repeat(300);
  const e = excerptForSpeech(long, 80);
  assert.ok(!e.includes("#") && !e.includes("*"));
  assert.ok(e.endsWith("."), e);
  assert.ok(e.length <= 80);
});

check(() => {
  assert.equal(
    composeBriefing(empty()),
    "All quiet. Nothing is running and nothing is waiting on you.",
  );
});

check(() => {
  const s = empty();
  s.working = [{ project: "heidi", sinceMin: 12 }];
  s.approvals = [{ id: "a1", title: "Send a message to Anna", type: "send_message" }];
  s.recentRuns = [
    { id: "r1", project: "orangecat", failed: true, finishedAt: null, note: "tsc: 3 errors" },
  ];
  const b = composeBriefing(s);
  assert.match(b, /one agent is working: heidi for 12 minutes\./);
  assert.match(b, /one thing is waiting on you\. Say "what's waiting"/);
  assert.match(b, /one run failed: orangecat\./);
  // Lead with the fleet, not with the builder being fine.
  assert.ok(!b.includes("online"));
});

check(() => {
  const s = empty();
  s.builderOnline = false;
  assert.match(composeBriefing(s), /^The builder is offline, so nothing can run\./);
});

check(() => {
  const s = empty();
  s.approvalsLocked = true;
  assert.match(composeBriefing(s), /locked behind your PIN/);
  assert.match(composeWaiting(s), /locked behind your PIN/);
});

check(() => {
  assert.equal(composeWaiting(empty()), "Nothing is waiting on you.");
  const s = empty();
  s.approvals = [
    { id: "a1", title: "Send a message to Anna", type: "send_message" },
    { id: "a2", title: "Book Friday 10:00 with Ben", type: "create_event" },
  ];
  const w = composeWaiting(s);
  assert.match(
    w,
    /^two things\. First: Send a message to Anna\. Second: Book Friday 10:00 with Ben\./,
  );
  assert.match(w, /approve the first one/);
});

check(() => {
  assert.equal(composeFailures(empty()), "Nothing failed today.");
  const s = empty();
  s.recentRuns = [
    { id: "r1", project: "aoz-begleitung", failed: true, finishedAt: null, note: null },
  ];
  assert.equal(composeFailures(s), "one failure. aoz begleitung: no error was recorded.");
});

check(() => {
  const h = composeHelp();
  assert.match(h, /^You can say: Status\. What's waiting on me\. /);
  assert.ok(!h.includes("?"), "spoken list carries no question marks");
});

check(() => {
  const prev = empty();
  const next = empty();
  next.recentRuns = [
    { id: "r2", project: "heidi", failed: false, finishedAt: null, note: "Header fits at 320px." },
  ];
  next.approvals = [{ id: "a1", title: "Reply to the reporter", type: "send_message" }];
  next.working = [{ project: "orangecat", sinceMin: 0 }];
  assert.deepEqual(diffSnapshots(prev, next), [
    { kind: "finished", project: "heidi", note: "Header fits at 320px." },
    { kind: "approval", id: "a1", title: "Reply to the reporter" },
    { kind: "started", project: "orangecat" },
  ]);
  // Nothing changed → nothing said.
  assert.deepEqual(diffSnapshots(next, next), []);
});

check(() => {
  const prev = empty();
  const next = empty();
  prev.builderOnline = true;
  next.builderOnline = false;
  assert.deepEqual(diffSnapshots(prev, next), [{ kind: "builder-offline" }]);
  assert.deepEqual(diffSnapshots(next, prev), [{ kind: "builder-online" }]);
});

check(() => {
  // A flood is capped.
  const prev = empty();
  const next = empty();
  next.recentRuns = Array.from({ length: 20 }, (_, i) => ({
    id: `r${i}`,
    project: "heidi",
    failed: false,
    finishedAt: null,
    note: null,
  }));
  assert.equal(diffSnapshots(prev, next).length, NO_SCREEN_MAX_ANNOUNCEMENTS);
});

console.log(`voice-briefing: ${n} checks ok`);
