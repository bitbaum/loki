import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { missionFromProject } from "@/lib/missions/project-mission";

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
assert.match(index, /reported progress, not independent verification/);
assert.match(detail, /requirePageUserId\(\)/);
assert.match(detail, /getProjectDossier\(userId, id\)/);
assert.match(detail, /if \(!dossier\) notFound\(\)/);
assert.match(detail, /self-reported in Goals/);
assert.match(nav, /href: "\/missions"/);
assert.match(nav, /NAV\.control, NAV\.missions, NAV\.projects/);
assert.doesNotMatch(index + detail, /export async function (POST|PATCH|PUT|DELETE)\(/);

console.log("✓ Missions — real project/goal sources, reported progress, tenant-scoped reads");
