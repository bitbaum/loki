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
  sentence,
  whereSaid,
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
  assert.match(b, /One agent is working: heidi for 12 minutes\./);
  assert.match(b, /One thing is waiting on you\. Say "what's waiting"/);
  assert.match(b, /One run failed on orangecat\./);
  // Lead with the fleet, not with the builder being fine.
  assert.ok(!b.includes("online"));
  // Read once from /today's Listen button: same facts, no spoken commands
  // inviting a reply that nothing is listening for.
  const quiet = composeBriefing(s, { hints: false });
  assert.match(quiet, /One thing is waiting on you\./);
  assert.match(quiet, /One run failed on orangecat\./);
  assert.ok(!quiet.includes("Say "));
});

check(() => {
  // The owner's briefing, 2026-10-20: every sentence starts with a capital,
  // and a project that repeats is named once, with how many.
  const s = empty();
  s.waitingForBuilder = [{ project: "loki", sinceMin: 4 }];
  s.approvalsLocked = true;
  const run = (id: string, project: string) => ({
    id,
    project,
    failed: true,
    finishedAt: null,
    note: null,
  });
  s.recentRuns = [run("r1", "loki"), run("r2", "loki"), run("r3", "loki")];
  assert.equal(
    composeBriefing(s),
    'Nobody is working right now. One run is waiting for a runner on loki. Approvals are locked behind your PIN. Unlock them on screen to hear them. Three runs failed on loki. Say "what failed" for the errors.',
  );
  s.recentRuns = [run("r1", "loki"), run("r2", "heidi"), run("r3", "loki"), run("r4", "loki")];
  assert.match(composeBriefing(s), /Four runs failed: loki three times and heidi once\./);
  s.recentRuns = [run("r1", "loki"), run("r2", "heidi")];
  assert.match(composeBriefing(s), /Two runs failed: loki and heidi\./);
  // Every sentence of a busy briefing opens with a capital.
  for (const part of composeBriefing(s).split(/(?<=\.) /)) assert.match(part, /^[A-Z"]/, part);
});

check(() => {
  assert.equal(sentence("three runs"), "Three runs");
  assert.equal(whereSaid([]), "");
  assert.equal(whereSaid(["loki"]), " on loki");
  assert.equal(whereSaid(["loki", "loki"]), " on loki");
  assert.equal(whereSaid(["a", "b", "c"]), ": a, b and c");
  assert.equal(whereSaid(["a", "b", "a"]), ": a twice and b once");
  // Several agents on one project: named once.
  const s = empty();
  s.working = [
    { project: "loki", sinceMin: 3 },
    { project: "loki", sinceMin: 9 },
    { project: "heidi", sinceMin: 12 },
  ];
  assert.match(
    composeBriefing(s),
    /^Three agents are working: two agents on loki and heidi for 12 minutes\./,
  );
  s.working = s.working.slice(0, 2);
  assert.match(composeBriefing(s), /^Two agents are working on loki\./);
});

check(() => {
  const s = empty();
  s.builderOnline = false;
  assert.match(composeBriefing(s), /^The runner is offline, so nothing can run\./);
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
    /^Two things\. First: Send a message to Anna\. Second: Book Friday 10:00 with Ben\./,
  );
  assert.match(w, /approve the first one/);
});

check(() => {
  assert.equal(composeFailures(empty()), "Nothing failed today.");
  const s = empty();
  s.recentRuns = [
    { id: "r1", project: "aoz-begleitung", failed: true, finishedAt: null, note: null },
  ];
  assert.equal(composeFailures(s), "One failure. aoz begleitung: no error was recorded.");
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
