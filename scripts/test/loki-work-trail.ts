/**
 * The work trail: what Loki said and ran on the way to an answer, as one list.
 *
 * The shape behind the Claude Code rhythm the operator reads all day — a
 * sentence, a collapsed group of commands, a sentence, the answer. Pure: the
 * same functions drive the live turn (hooks/use-loki-stream) and the reopened
 * one (MessageTurn via provenance), so a thread reads identically watched and
 * revisited.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DETAIL_MAX_CHARS,
  applyNote,
  applyToolStep,
  describeArgs,
  groupWork,
  readWork,
  summarizeTools,
  type WorkStep,
} from "../../src/lib/loki/work";

// Consecutive tools fold into one group; notes stand alone; blank notes vanish.
const work: WorkStep[] = [
  { kind: "note", text: "Two runs failed overnight — reading them." },
  { kind: "tool", name: "list_runs", phase: "end", facts: 7 },
  { kind: "tool", name: "list_projects", phase: "end", facts: 3 },
  { kind: "note", text: " " },
  { kind: "note", text: "Both are on sink. Checking who owns it." },
  { kind: "tool", name: "search_people", phase: "fail" },
];
const segments = groupWork(work);
assert.equal(segments.length, 4, "note · [2 tools] · note · [1 tool]");
assert.equal(segments[0].kind, "note");
assert.equal(segments[1].kind, "tools");
if (segments[1].kind === "tools") assert.equal(segments[1].tools.length, 2);
assert.equal(segments[2].kind, "note");
assert.equal(segments[3].kind, "tools");

// The one-line summary: steps, records (0 is a real answer), failures.
assert.equal(
  summarizeTools([
    { kind: "tool", name: "a", phase: "end", facts: 7 },
    { kind: "tool", name: "b", phase: "end", facts: 0 },
  ]),
  "2 steps · 7 records",
);
assert.equal(
  summarizeTools([{ kind: "tool", name: "a", phase: "end", facts: 1 }]),
  "1 step · 1 record",
);
assert.equal(
  summarizeTools([{ kind: "tool", name: "a", phase: "fail" }]),
  "1 step · 0 records · 1 failed",
);

// Live: a tool moves running → done in place, matching the LAST running step
// of that name, so two calls to one tool in a round each close their own.
let live: WorkStep[] = [];
live = applyToolStep(live, { kind: "tool", name: "search_people", phase: "start" });
live = applyToolStep(live, { kind: "tool", name: "search_people", phase: "start" });
live = applyToolStep(live, { kind: "tool", name: "search_people", phase: "end", facts: 2 });
assert.deepEqual(live, [
  { kind: "tool", name: "search_people", phase: "start" },
  { kind: "tool", name: "search_people", phase: "end", facts: 2 },
]);
// An end with no matching start is still recorded, never dropped.
live = applyToolStep(live, { kind: "tool", name: "list_goals", phase: "fail" });
assert.equal(live.length, 3);

// Live: a note streamed in pieces replaces the open note rather than stacking.
let noted: WorkStep[] = [{ kind: "tool", name: "list_runs", phase: "end", facts: 1 }];
noted = applyNote(noted, "Found it");
noted = applyNote(noted, "Found it — checking who owns it.");
assert.deepEqual(noted, [
  { kind: "tool", name: "list_runs", phase: "end", facts: 1 },
  { kind: "note", text: "Found it — checking who owns it." },
]);

// The command under a step: arguments as one short line, never `{}`.
assert.equal(describeArgs({ query: "Elena", limit: 5 }), 'query: "Elena", limit: 5');
assert.equal(describeArgs({}), undefined);
assert.equal(describeArgs({ q: "" }), undefined);
assert.equal(describeArgs("nope"), undefined);
const long = describeArgs({ query: "x".repeat(200) })!;
assert.ok(long.length <= DETAIL_MAX_CHARS && long.endsWith("…"), "cut to one line");
assert.equal(describeArgs({ q: "two\nlines" })!.includes("\n"), false, "one line");

// Persisted meta: only finished steps and real notes; junk is ignored.
assert.deepEqual(
  readWork({
    work: [
      { kind: "note", text: "x" },
      { kind: "tool", name: "a", phase: "start" },
      { kind: "tool", name: "b", phase: "end", facts: 4, detail: 'q: "x"' },
      { kind: "tool", name: "c", phase: "fail" },
      null,
      "nope",
      { kind: "tool", phase: "end" },
    ],
  }),
  [
    { kind: "note", text: "x" },
    { kind: "tool", name: "b", phase: "end", facts: 4, detail: 'q: "x"' },
    { kind: "tool", name: "c", phase: "fail" },
  ],
);

// The queue: a send during a turn is taken, shown, and flushed after.
const workspace = readFileSync("src/components/loki/LokiWorkspace.tsx", "utf8");
assert.match(
  workspace,
  /if \(sending && !dispatchOnly\) \{\s*queue\.add/,
  "a send while running is queued",
);
assert.match(
  workspace,
  /if \(landed\) \{\s*const next = queue\.takeNext\(\)/,
  "drained after a turn lands, never from an effect",
);
assert.match(workspace, /<QueuedMessages items=\{queue\.items\}/, "queued messages are shown");
assert.match(
  workspace,
  /<LokiComposer[\s\S]*?\n\s+queue\n/,
  "the composer takes messages while running",
);
assert.deepEqual(readWork(null), []);
assert.deepEqual(readWork({}), []);

// Wiring: the loop keeps the note and streams it; the hook applies both kinds
// of event to the same list; the thread renders a persisted turn's work above
// its answer with the same component the live turn uses.
const loop = readFileSync("src/lib/agent/loop.ts", "utf8");
assert.match(loop, /work\.push\(\{ kind: "note"/, "the loop keeps a gathering round's prose");
assert.match(loop, /emit\(\{ type: "note"/, "and streams it");
const hook = readFileSync("src/hooks/use-loki-stream.ts", "utf8");
assert.match(hook, /applyNote\(base\.work/, "the hook applies notes to the work list");
assert.match(hook, /applyToolStep\(base\.work/, "and tool steps");
const turn = readFileSync("src/components/loki/MessageTurn.tsx", "utf8");
assert.match(turn, /<WorkTrail work=\{work\} live=\{false\} \/>/, "a reopened turn shows its work");
const thread = readFileSync("src/components/loki/Thread.tsx", "utf8");
assert.match(
  thread,
  /<WorkTrail work=\{live\.work\} live \/>/,
  "the live turn shows the same list",
);

console.log("loki-work-trail: ok");
