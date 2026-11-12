/**
 * One unit of work, one row.
 *
 * Reported from a phone 2026-08-26: the Activity feed showed every dispatch
 * twice at the same minute — "sbb-lost-found - Next best" immediately followed
 * by "sbb-lost-found - Next best - waiting" — because prompt_history and
 * orchestration_runs are two rows describing the same action, and the feed
 * rendered both. Neither copy was complete on its own.
 *
 * These cases pin the join: pairing, 1:1 consumption under bursts, and the two
 * half-events (dispatch with no run, run with no dispatch) that must still
 * render rather than vanish.
 *
 * Run: npx tsx scripts/test/activity-events.ts (or npm run test:unit)
 */
import assert from "node:assert/strict";
import {
  CORRELATION_WINDOW_MS,
  buildActivityEvents,
  filterActivityEvents,
  groupEventsByDay,
  normalizeActivityFilter,
  tallyActivityEvents,
  type PromptSource,
  type RunSource,
} from "@/lib/activity-events";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ${label}`);
};

const T0 = new Date("2026-08-26T04:00:00.000Z");
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

function prompt(over: Partial<PromptSource> = {}): PromptSource {
  return {
    id: "p1",
    projectKey: "sbb-lost-found",
    adapter: "claude",
    intent: "next_best",
    customPrompt: null,
    resolvedPrompt: "Work on the project at /x.\n\nPick the highest-impact task.",
    dispatchedAt: T0,
    ...over,
  };
}

function run(over: Partial<RunSource> = {}): RunSource {
  return {
    id: "r1",
    projectKey: "sbb-lost-found",
    adapter: "claude",
    intent: "next_best",
    state: "running",
    outcome: null,
    summary: null,
    payload: null,
    startedAt: T0,
    finishedAt: null,
    ...over,
  };
}

console.log("buildActivityEvents - the join");

check("a dispatch and its run collapse into ONE event, not two rows", () => {
  const events = buildActivityEvents({ prompts: [prompt()], runs: [run()] });
  assert.equal(events.length, 1, "expected a single correlated event");
  assert.equal(events[0].runId, "r1");
  assert.equal(events[0].promptId, "p1");
});

check("the single event carries BOTH the ask and the outcome", () => {
  const [event] = buildActivityEvents({
    prompts: [prompt()],
    runs: [
      run({
        outcome: "success",
        finishedAt: at(90_000),
        summary: { done: "Fixed the parser", next: "Ship it" },
      }),
    ],
  });
  assert.ok(event.ask?.preview.includes("Pick the highest-impact task"), event.ask?.preview);
  assert.equal(event.done, "Fixed the parser");
  assert.equal(event.next, "Ship it");
  assert.equal(event.outcome, "success");
  assert.equal(event.durationLabel, "1m 30s");
});

check("a burst pairs 1:1 by closest time - no run reuses another's prompt", () => {
  const prompts = [
    prompt({ id: "pA", dispatchedAt: at(0) }),
    prompt({ id: "pB", dispatchedAt: at(30_000) }),
    prompt({ id: "pC", dispatchedAt: at(60_000) }),
  ];
  const runs = [
    run({ id: "rA", startedAt: at(1_000) }),
    run({ id: "rB", startedAt: at(31_000) }),
    run({ id: "rC", startedAt: at(61_000) }),
  ];
  const events = buildActivityEvents({ prompts, runs });
  assert.equal(events.length, 3, "three dispatches, three runs, three events");
  const pairing = new Map(events.map((e) => [e.runId, e.promptId]));
  assert.equal(pairing.get("rA"), "pA");
  assert.equal(pairing.get("rB"), "pB");
  assert.equal(pairing.get("rC"), "pC");
});

check("a dispatch nothing ran still renders, marked Sent", () => {
  const events = buildActivityEvents({ prompts: [prompt()], runs: [] });
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "dispatched");
  assert.equal(events[0].outcomeLabel, "Sent");
  assert.equal(events[0].runId, null);
});

check("a run with no dispatch row still renders", () => {
  const events = buildActivityEvents({
    prompts: [],
    runs: [run({ outcome: "success", finishedAt: at(1_000) })],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].ask, null, "no ask to show, and that is honest");
  assert.equal(events[0].outcome, "success");
});

check("rows far apart in time are NOT paired", () => {
  const events = buildActivityEvents({
    prompts: [prompt({ dispatchedAt: at(0) })],
    runs: [run({ startedAt: at(CORRELATION_WINDOW_MS + 1_000) })],
  });
  assert.equal(events.length, 2, "unrelated rows must stay separate events");
});

check("a different project never claims another's dispatch", () => {
  const events = buildActivityEvents({
    prompts: [prompt({ projectKey: "printcraft" })],
    runs: [run({ projectKey: "sbb-lost-found" })],
  });
  assert.equal(events.length, 2);
});

check("the event is anchored to when work was ASKED for, not when it finished", () => {
  const [event] = buildActivityEvents({
    prompts: [prompt({ dispatchedAt: at(0) })],
    runs: [run({ startedAt: at(1_000), finishedAt: at(3_600_000), outcome: "success" })],
  });
  assert.equal(event.occurredAt, T0.toISOString());
});

check("a real blocked reason beats the reaper's circular timeout text", () => {
  const [event] = buildActivityEvents({
    prompts: [],
    runs: [
      run({
        id: "r9",
        outcome: "timeout",
        finishedAt: at(10),
        payload: { error: "exceeded max duration" },
      }),
    ],
    blockedReasons: new Map([
      ["r9", "injected to running claude (pty), but the agent isn't generating"],
    ]),
  });
  assert.ok(event.error?.includes("isn't generating"), String(event.error));
});

check("events come back newest first", () => {
  const events = buildActivityEvents({
    prompts: [
      prompt({ id: "old", projectKey: "a", dispatchedAt: at(0) }),
      prompt({ id: "new", projectKey: "b", dispatchedAt: at(60_000) }),
    ],
    runs: [],
  });
  assert.deepEqual(
    events.map((e) => e.promptId),
    ["new", "old"],
  );
});

console.log("\ntriage");

const mixed = buildActivityEvents({
  prompts: [],
  runs: [
    run({ id: "e1", projectKey: "a", outcome: "error", finishedAt: at(1) }),
    run({ id: "e2", projectKey: "b", outcome: "timeout", finishedAt: at(1) }),
    run({ id: "e3", projectKey: "c", outcome: "partial", finishedAt: at(1) }),
    run({ id: "e4", projectKey: "d", outcome: "success", finishedAt: at(1) }),
    run({ id: "e5", projectKey: "e", state: "running", finishedAt: null }),
  ],
  nowMs: T0.getTime() + 60_000,
});

check("tallies count what a person triages by", () => {
  const t = tallyActivityEvents(mixed);
  assert.equal(t.total, 5);
  assert.equal(t.attention, 3, "error + timeout + partial");
  assert.equal(t.running, 1);
  assert.equal(t.done, 1);
});

check("the attention filter surfaces exactly the failures and partials", () => {
  const got = filterActivityEvents(mixed, "attention")
    .map((e) => e.outcome)
    .sort();
  assert.deepEqual(got, ["error", "partial", "timeout"]);
});

check("running and done filters are exact", () => {
  assert.equal(filterActivityEvents(mixed, "running").length, 1);
  assert.equal(filterActivityEvents(mixed, "done").length, 1);
  assert.equal(filterActivityEvents(mixed, "all").length, 5);
});

check("an unfinished run is only Running when it is (Home's rule, 2026-11-12)", () => {
  const now = T0.getTime() + 3 * 3_600_000;
  const fresh = new Date(now - 60_000).toISOString();
  const stale = new Date(now - 2 * 3_600_000).toISOString();
  const events = buildActivityEvents({
    prompts: [],
    runs: [
      run({ id: "w", projectKey: "w", payload: { blocked: "permission" } }),
      run({
        id: "s",
        projectKey: "s",
        payload: { lastProgressAt: stale, lastStep: { text: "x" } },
      }),
      run({ id: "n", projectKey: "n" }),
      run({
        id: "r",
        projectKey: "r",
        payload: { lastProgressAt: fresh, lastStep: { text: "x" } },
      }),
    ],
    nowMs: now,
  });
  const by = new Map(events.map((e) => [e.projectKey, e]));
  assert.equal(by.get("w")?.outcome, "waiting");
  assert.equal(by.get("w")?.outcomeLabel, "Waiting for you");
  assert.equal(by.get("s")?.outcome, "silent");
  assert.equal(by.get("n")?.outcome, "not_started");
  assert.equal(by.get("r")?.outcome, "running");
  const t = tallyActivityEvents(events);
  assert.equal(t.running, 1, "only the run that is working counts as running");
  assert.equal(t.attention, 1, "a run waiting for you needs you");
  assert.equal(t.queued, 1, "a run never picked up is queued");
});

check("an unknown filter value falls back to all", () => {
  assert.equal(normalizeActivityFilter("nonsense"), "all");
  assert.equal(normalizeActivityFilter(undefined), "all");
  assert.equal(normalizeActivityFilter("attention"), "attention");
});

console.log("\nday grouping");

check("consecutive events on one day share a single header", () => {
  const events = buildActivityEvents({
    prompts: [
      prompt({ id: "p1", projectKey: "a", dispatchedAt: new Date("2026-08-26T09:00:00Z") }),
      prompt({ id: "p2", projectKey: "b", dispatchedAt: new Date("2026-08-26T08:00:00Z") }),
      prompt({ id: "p3", projectKey: "c", dispatchedAt: new Date("2026-08-25T23:00:00Z") }),
    ],
    runs: [],
  });
  const groups = groupEventsByDay(events);
  assert.deepEqual(
    groups.map((g) => g.day),
    ["2026-08-26", "2026-08-25"],
  );
  assert.equal(groups[0].events.length, 2);
  assert.equal(groups[1].events.length, 1);
});

console.log("\nintentId — what a retry replays");

check("the RAW intent id rides along, not just its label", () => {
  const [event] = buildActivityEvents({ prompts: [prompt()], runs: [run()] });
  assert.equal(
    event.intentId,
    "next_best",
    "the label alone cannot be handed back to the pipeline",
  );
  assert.notEqual(event.intentId, event.intentLabel, "label and id are different things");
});

check("a dispatch with no run keeps its intent id too", () => {
  const [event] = buildActivityEvents({ prompts: [prompt({ intent: "test_and_fix" })], runs: [] });
  assert.equal(event.intentId, "test_and_fix");
});

check("a locally-typed prompt is marked custom and flagged as local", () => {
  const [event] = buildActivityEvents({
    prompts: [],
    runs: [],
    localChats: [{ id: "c1", projectKey: "a", gitBranch: null, promptText: "hey", occurredAt: T0 }],
  });
  assert.equal(event.intentId, "custom");
  assert.equal(
    event.isLocalChat,
    true,
    "local chat was never dispatched, so it must not offer a re-dispatch",
  );
});

console.log(`\n${passed}/${passed} activity-events cases passed`);
