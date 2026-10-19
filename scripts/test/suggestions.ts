// /suggestions reads every front of a person's life into one board. Pinned
// here: only the person can check off a habit or accept a delivery, so those
// OPEN the place and carry no prompt; a renewal, a stale contact, a due goal
// go to Loki and carry no project; someone waiting on you outranks a note to
// reconnect; a decision hides a suggestion for its window and no longer; the
// build row honours the same decisions; momentum is counted from decisions
// alone; every kind the rankers emit has an avenue.
// Run: npx tsx scripts/test/suggestions.ts
import assert from "node:assert/strict";
import { EMPTY_LIFE_INPUTS, lifeCandidates } from "@/lib/suggestions/life";
import { buildBoard, hiddenIds, momentumFrom } from "@/lib/suggestions/board";
import { rankBuildSuggestions } from "@/lib/build-suggestions/rank";
import {
  DISMISSED_HIDE_DAYS,
  TAKEN_HIDE_DAYS,
  type SuggestionDecisionRecord,
} from "@/lib/suggestions/types";
import { KIND_AVENUE, SUGGESTION_AVENUES } from "@/config/suggestion-avenues";
import { SIDEBAR_SECTIONS } from "@/config/navigation";
import { DAY_MS } from "@/lib/constants/time";

// A Wednesday at noon, so weekday habits are scheduled.
const NOW = new Date("2026-10-14T12:00:00");
const iso = (daysFromNow: number) => new Date(NOW.getTime() + daysFromNow * DAY_MS).toISOString();

// ---- habits and deliveries open the place; nothing pretends Loki can do them ----
{
  const out = lifeCandidates(
    {
      ...EMPTY_LIFE_INPUTS,
      habits: [
        { id: "h1", title: "Run", frequency: "daily", doneToday: false, streak: 12 },
        { id: "h2", title: "Read", frequency: "daily", doneToday: true, streak: 3 },
        { id: "h3", title: "Review", frequency: "weekly", doneToday: false, streak: 0 },
      ],
      crewTasks: [
        { id: "t1", title: "Logo", status: "delivered", assigneeName: "Mia", updatedAt: iso(-1) },
        { id: "t2", title: "Copy", status: "draft", assigneeName: null, updatedAt: iso(-5) },
        { id: "t3", title: "Fresh", status: "draft", assigneeName: null, updatedAt: iso(0) },
      ],
    },
    NOW,
  );
  const ids = out.map((s) => s.id);
  assert.ok(ids.includes("habit:h1"), "an unchecked habit due today is offered");
  assert.ok(!ids.includes("habit:h2"), "a habit already checked off is not");
  assert.ok(!ids.includes("habit:h3"), "a weekly habit is not offered mid-week");
  const run = out.find((s) => s.id === "habit:h1")!;
  assert.equal(run.prompt, null);
  assert.equal(run.href, "/today#habits", "a habit opens where it is checked off");
  assert.match(run.label, /Keep the streak/);
  assert.ok(ids.includes("crew_review:t1"), "a delivered task asks for the yes");
  assert.ok(ids.includes("crew_handover:t2"), "an old draft asks to be handed over");
  assert.ok(!ids.includes("crew_handover:t3"), "a draft written today is left alone");
  assert.equal(out.find((s) => s.id === "crew_review:t1")!.href, "/crew");
  for (const s of out) assert.equal(s.project, null, `${s.id}: life suggestions never dispatch`);
}

// ---- renewals, stale contacts and due goals go to Loki, with the fact in the ask ----
{
  const out = lifeCandidates(
    {
      ...EMPTY_LIFE_INPUTS,
      renewals: [
        {
          id: "r1",
          name: "Figma",
          amount: 15,
          currency: "CHF",
          frequency: "monthly",
          nextCharge: iso(2),
        },
      ],
      stalePeople: [
        { id: "p1", name: "Anna", lastInteraction: iso(-40) },
        { id: "p2", name: "Ben", lastInteraction: iso(-200) },
        { id: "p3", name: "Cy", lastInteraction: null },
        { id: "p4", name: "Dee", lastInteraction: iso(-90) },
      ],
      goalsDue: [
        { id: "g1", title: "Launch", progress: 40, targetDate: iso(3) },
        { id: "g2", title: "Done already", progress: 100, targetDate: iso(3) },
      ],
      eventsDue: [{ id: "e1", title: "Grant", type: "deadline", deadline: iso(1) }],
    },
    NOW,
  );
  const renewal = out.find((s) => s.id === "renewal:r1")!;
  assert.ok(renewal.prompt?.includes("Figma") && renewal.prompt.includes("CHF 15"));
  assert.match(renewal.label, /Renews in 2 days: Figma/);
  const reconnect = out.filter((s) => s.kind === "reconnect");
  assert.equal(reconnect.length, 3, "at most three contacts, the most recently seen first");
  assert.deepEqual(
    reconnect.map((s) => s.id),
    ["reconnect:p1", "reconnect:p4", "reconnect:p2"],
  );
  assert.ok(reconnect[0].prompt?.includes("Anna") && reconnect[0].prompt.includes("40 days"));
  assert.ok(out.some((s) => s.id === "goal_due:g1"));
  assert.ok(!out.some((s) => s.id === "goal_due:g2"), "a finished goal is not due");
  assert.match(out.find((s) => s.id === "event_due:e1")!.label, /Deadline tomorrow: Grant/);
}

// ---- across the board, someone waiting on you outranks a note to reconnect ----
{
  const life = lifeCandidates(
    {
      ...EMPTY_LIFE_INPUTS,
      stalePeople: [{ id: "p1", name: "Anna", lastInteraction: iso(-40) }],
      renewals: [
        {
          id: "r1",
          name: "Figma",
          amount: null,
          currency: null,
          frequency: null,
          nextCharge: iso(5),
        },
      ],
      crewTasks: [
        { id: "t1", title: "Logo", status: "delivered", assigneeName: "Mia", updatedAt: iso(-1) },
      ],
    },
    NOW,
  );
  const board = buildBoard({ suggestions: life, decisions: [], lockedAvenues: [], now: NOW });
  const flat = board.avenues.flatMap((a) => a.suggestions);
  assert.equal(board.total, 3);
  const score = (kind: string) => flat.find((s) => s.kind === kind)!.score;
  assert.ok(
    score("crew_review") > score("renewal"),
    "a delivery waiting on you outranks a renewal",
  );
  assert.ok(score("renewal") > score("reconnect"), "a renewal outranks a note to reconnect");
  assert.deepEqual(
    board.avenues.map((a) => a.id),
    SUGGESTION_AVENUES.map((a) => a.id),
    "every avenue is on the board, in config order, even when empty",
  );
  assert.deepEqual(
    board.avenues.find((a) => a.id === "business")!.suggestions.map((s) => s.id),
    ["crew_review:t1"],
  );
}

// ---- a decision hides for its window, no longer; locked avenues are said so ----
{
  const decisions: SuggestionDecisionRecord[] = [
    {
      id: "d1",
      suggestionId: "renewal:r1",
      decision: "dismissed",
      createdAt: iso(-(DISMISSED_HIDE_DAYS - 1)),
    },
    {
      id: "d2",
      suggestionId: "reconnect:p1",
      decision: "dismissed",
      createdAt: iso(-(DISMISSED_HIDE_DAYS + 1)),
    },
    {
      id: "d3",
      suggestionId: "crew_review:t1",
      decision: "taken",
      createdAt: iso(-(TAKEN_HIDE_DAYS - 1)),
    },
    {
      id: "d4",
      suggestionId: "habit:h1",
      decision: "taken",
      createdAt: iso(-(TAKEN_HIDE_DAYS + 1)),
    },
  ];
  const hidden = hiddenIds(decisions, NOW);
  assert.deepEqual([...hidden].sort(), ["crew_review:t1", "renewal:r1"]);

  const life = lifeCandidates(
    {
      ...EMPTY_LIFE_INPUTS,
      stalePeople: [{ id: "p1", name: "Anna", lastInteraction: iso(-40) }],
      renewals: [
        {
          id: "r1",
          name: "Figma",
          amount: null,
          currency: null,
          frequency: null,
          nextCharge: iso(5),
        },
      ],
      crewTasks: [
        { id: "t1", title: "Logo", status: "delivered", assigneeName: "Mia", updatedAt: iso(-1) },
      ],
      habits: [{ id: "h1", title: "Run", frequency: "daily", doneToday: false, streak: 1 }],
    },
    NOW,
  );
  const board = buildBoard({
    suggestions: life,
    decisions,
    lockedAvenues: ["people", "money", "habits"],
    now: NOW,
  });
  assert.deepEqual(
    board.avenues.flatMap((a) => a.suggestions.map((s) => s.id)).sort(),
    ["habit:h1", "reconnect:p1"],
    "a decision past its window no longer hides",
  );
  for (const a of board.avenues) {
    assert.equal(a.locked, ["people", "money", "habits"].includes(a.id), `${a.id} locked flag`);
  }
}

// ---- the build row honours the same decisions ----
{
  const { suggestions } = rankBuildSuggestions(
    {
      projects: [
        {
          name: "sink",
          description: null,
          stack: null,
          liveUrl: null,
          runnable: true,
          nextStep: null,
          nextStepDate: null,
        },
      ],
      openFeedback: { sink: 2 },
      stuckGoals: [],
      commitmentsDue: [],
      captures: [],
      demand: [],
    },
    { exclude: new Set(["fix:sink"]) },
  );
  assert.deepEqual(
    suggestions.map((s) => s.id),
    ["ship:sink"],
    "a dismissed fix is not re-offered on /loki",
  );
}

// ---- momentum is a record of decisions, nothing else ----
{
  const taken = (id: string, daysAgo: number): SuggestionDecisionRecord => ({
    id,
    suggestionId: `x:${id}`,
    decision: "taken",
    createdAt: iso(-daysAgo),
  });
  assert.deepEqual(momentumFrom([], NOW), { takenThisWeek: 0, takenAllTime: 0, dayStreak: 0 });
  const m = momentumFrom(
    [
      taken("a", 0),
      taken("b", 1),
      taken("c", 2),
      taken("d", 4), // gap on day 3 ends the streak
      taken("e", 20),
      { id: "f", suggestionId: "x:f", decision: "dismissed", createdAt: iso(0) },
    ],
    NOW,
  );
  assert.deepEqual(m, { takenThisWeek: 4, takenAllTime: 5, dayStreak: 3 });
  // A day is not lost until it is over: a streak ending yesterday still stands.
  assert.equal(momentumFrom([taken("a", 1), taken("b", 2)], NOW).dayStreak, 2);
}

// ---- every kind has an avenue; the page has a sidebar seat beside Approvals ----
{
  const sample = lifeCandidates(
    {
      habits: [{ id: "h", title: "Run", frequency: "daily", doneToday: false, streak: 0 }],
      renewals: [
        { id: "r", name: "X", amount: null, currency: null, frequency: null, nextCharge: iso(1) },
      ],
      stalePeople: [{ id: "p", name: "A", lastInteraction: null }],
      crewTasks: [
        { id: "t", title: "L", status: "delivered", assigneeName: null, updatedAt: iso(-1) },
        { id: "u", title: "M", status: "draft", assigneeName: null, updatedAt: iso(-9) },
      ],
      goalsDue: [{ id: "g", title: "G", progress: 0, targetDate: iso(1) }],
      eventsDue: [{ id: "e", title: "E", type: "deadline", deadline: iso(1) }],
    },
    NOW,
  );
  const avenueIds = new Set(SUGGESTION_AVENUES.map((a) => a.id));
  for (const s of sample) {
    assert.ok(avenueIds.has(KIND_AVENUE[s.kind]), `${s.kind} belongs to a real avenue`);
    assert.ok(s.label.length <= 44, `${s.id}: label fits a phone row`);
    assert.ok(Boolean(s.prompt) !== Boolean(s.href), `${s.id}: exactly one of prompt / href`);
  }
  const review = SIDEBAR_SECTIONS.find((s) => s.id === "review")!;
  const ids = review.items.map((i) => i.id);
  assert.ok(
    ids.includes("suggestions") && ids.includes("approvals"),
    "Suggestions sits with Approvals, in what waits for a yes",
  );
}

console.log("✓ suggestions tests passed");
