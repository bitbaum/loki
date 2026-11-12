import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { goalsLine, missionFromProject } from "@/lib/missions/project-mission";
import { missionRunRow } from "@/lib/missions/run-row";

const base = {
  projectId: "project-1",
  name: "evig",
  mission: "Make computing affordable",
  nextStep: null,
  goals: [],
};

const empty = missionFromProject({ ...base, mission: null });
assert.equal(empty.phase, "needs-objective");
assert.equal(empty.statement, null);
assert.equal(empty.reportedProgress, null);
assert.equal(empty.goalsTotal, 0);
assert.equal(empty.nextObjective, null);

const defined = missionFromProject(base);
assert.equal(defined.phase, "ready");
assert.equal(defined.statement, "Make computing affordable");
assert.equal(defined.reportedProgress, null);

const withGoals = missionFromProject({
  ...base,
  goals: [
    { id: "a", title: "Verify donated laptop", status: "active", progress: 60 },
    { id: "b", title: "Publish certified device", status: "active", progress: 0 },
    { id: "c", title: "Old scope", status: "abandoned", progress: 100 },
  ],
});
assert.equal(withGoals.phase, "in-progress");
assert.equal(withGoals.reportedProgress, 30);
assert.equal(withGoals.goalsTotal, 2);
assert.equal(withGoals.goalsReportedDone, 0);
assert.equal(withGoals.nextObjective, "Verify donated laptop");
assert.equal(
  withGoals.objectives.some((g) => g.id === "c"),
  false,
);

const completed = missionFromProject({
  ...base,
  goals: [
    { id: "a", title: "Device inspected", status: "completed", progress: 3 },
    { id: "b", title: "Published", status: "completed", progress: null },
  ],
});
assert.equal(completed.phase, "reported-complete");
assert.equal(completed.reportedProgress, 100);
assert.equal(completed.goalsReportedDone, 2);
assert.ok(completed.objectives.every((goal) => goal.reportedDone));

const badNumbers = missionFromProject({
  ...base,
  goals: [
    { id: "a", title: "A", status: "active", progress: Number.NaN },
    { id: "b", title: "B", status: "active", progress: Number.POSITIVE_INFINITY },
    { id: "c", title: "C", status: "active", progress: 500 },
  ],
});
assert.equal(badNumbers.reportedProgress, 33);
assert.equal(badNumbers.phase, "in-progress");
assert.equal(badNumbers.goalsReportedDone, 0, "100% numeric progress is not a completed goal");

const next = missionFromProject({
  ...base,
  nextStep: "Request a physical boot-test",
  goals: [{ id: "a", title: "AI proposal", status: "active", progress: 0 }],
});
assert.equal(next.nextObjective, "Request a physical boot-test");

const index = readFileSync("src/app/(app)/missions/page.tsx", "utf8");
const detail = readFileSync("src/app/(app)/missions/[id]/page.tsx", "utf8");
const nav = readFileSync("src/config/navigation.ts", "utf8");

assert.match(index, /requirePageUserId\(\)/);
assert.match(index, /getProjects\(userId\)/);
assert.match(index, /getGoals\(userId\)/);
assert.match(index, /getProjectsLastDispatch\(userId\)/);
assert.match(index, /<MissionsBoard missions={missions}/);
assert.match(index, /missionAlertFromProject\(project\)/);
assert.match(detail, /requirePageUserId\(\)/);
assert.match(detail, /getProjectDossier\(userId, id\)/);
assert.match(detail, /if \(!dossier\) notFound\(\)/);
assert.match(detail, /goalsLine\(/);
assert.doesNotMatch(detail, /verified complete|independently verified/i);
assert.match(nav, /href: "\/missions"/);
// Missions is a view across projects, folded under that question since the
// sidebar became three words + folds (2026-11-01, AGENTS.md "Why Loki exists").
assert.match(nav, /NAV\.terminal, NAV\.missions, NAV\.activity, NAV\.prompts/);
assert.doesNotMatch(index + detail, /export async function (POST|PATCH|PUT|DELETE)\(/);

// One progress measure, said grammatically.
assert.equal(goalsLine(0, 1), "0 of 1 goal reported done");
assert.equal(goalsLine(4, 14), "4 of 14 goals reported done");
assert.doesNotMatch(detail, /reportedProgress/, "the detail shows one measure, not two");

// Recent runs: what it is, whether it started, when, and a way to watch it.
const now = Date.now();
const runBase = {
  id: "r1",
  intent: "custom",
  outcome: null,
  startedAt: new Date(now - 5 * 60_000),
  finishedAt: null,
  summary: null,
  payload: null,
};
const waiting = missionRunRow({ ...runBase, state: "waiting" }, "p1");
assert.equal(waiting.status, "Waiting to start");
assert.equal(waiting.href, "/projects/p1/watch?run=r1");
assert.match(waiting.when, /ago/);
const working = missionRunRow(
  {
    ...runBase,
    state: "waiting",
    payload: { deliveredAt: new Date(now).toISOString(), lastStep: { text: "Fixing the header" } },
  },
  "p1",
);
assert.equal(working.status, "Working now");
assert.equal(working.title, "Fixing the header");
const failed = missionRunRow(
  { ...runBase, state: "error", outcome: "error", finishedAt: new Date(now) },
  "p1",
);
assert.equal(failed.status, "Stopped with a problem");
assert.equal(failed.tone, "negative");
assert.doesNotMatch(detail, /Running or queued/);

console.log("✓ Missions — real project/goal sources, reported progress, tenant-scoped reads");
