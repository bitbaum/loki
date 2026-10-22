import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { missionFromProject } from "@/lib/missions/project-mission";
import {
  filterMissionBoard,
  missionAlertFromProject,
  type MissionBoardItem,
} from "@/lib/missions/mission-board";

const noIssues = { attrs: {}, attrMeta: {}, liveUrl: null, siteOk: null };
assert.equal(missionAlertFromProject(noIssues), null);

const issue = missionAlertFromProject({
  ...noIssues,
  attrs: { security_vulnerability: "Unpatched dependency" },
});
assert.deepEqual(issue, {
  label: "Security issue reported",
  detail: "Unpatched dependency",
});
assert.equal(
  missionAlertFromProject({
    ...noIssues,
    attrs: { security_vulnerability: "Old warning" },
    attrMeta: {
      security_vulnerability: {
        updatedAt: "2026-10-10",
        validUntil: "2020-01-01",
        source: "operator",
      },
    },
  }),
  null,
  "expired flags must not reappear on Missions",
);
assert.equal(
  missionAlertFromProject({
    ...noIssues,
    attrs: { broken_features: "Unreviewed imported note" },
    attrMeta: {
      broken_features: {
        updatedAt: "2026-10-10",
        validUntil: null,
        source: "knowledge.sqlite",
      },
    },
  }),
  null,
  "unchecked imported memories must not become active warnings",
);
assert.deepEqual(
  missionAlertFromProject({
    ...noIssues,
    attrs: { deployment_issue: "Deploy stalled" },
  }),
  { label: "Deployment issue reported", detail: "Deploy stalled" },
);
assert.deepEqual(
  missionAlertFromProject({
    ...noIssues,
    liveUrl: "https://example.invalid",
    siteOk: false,
  }),
  {
    label: "Site check failed",
    detail: "The latest site probe reported a failure.",
  },
);
assert.equal(
  missionAlertFromProject({
    ...noIssues,
    liveUrl: null,
    siteOk: false,
  }),
  null,
  "without a site, there is no site probe to fail",
);

function item(
  id: string,
  overrides: Partial<MissionBoardItem> = {},
): MissionBoardItem {
  const projection = missionFromProject({
    projectId: id,
    name: id,
    mission: "Refurbish electronics",
    nextStep: null,
    goals: [],
  });
  return {
    ...projection,
    alert: null,
    lastDispatchAt: null,
    ...overrides,
  };
}

const work = item("active", {
  phase: "in-progress",
  nextObjective: "Test the screen",
  objectives: [{ id: "g", title: "Screen test", status: "active", progress: 30, reportedDone: false }],
  lastDispatchAt: "2026-10-20T10:00:00Z",
});
const flagged = item("critical", { alert: issue, lastDispatchAt: "2020-01-01T00:00:00Z" });
const planning = item("planning", { phase: "needs-objective", statement: null });
const finished = item("done", { phase: "reported-complete", goalsTotal: 1, goalsReportedDone: 1 });
const recentWork = item("recent", {
  phase: "in-progress",
  lastDispatchAt: "2026-10-21T10:00:00Z",
});
const board = [planning, finished, work, flagged, recentWork];

assert.deepEqual(
  filterMissionBoard(board, "", "all").map((x) => x.projectId),
  ["critical", "recent", "active", "planning", "done"],
  "real project attention first, active work next, then recency",
);
assert.deepEqual(
  filterMissionBoard(board, "", "attention").map((x) => x.projectId),
  ["critical"],
);
assert.deepEqual(
  filterMissionBoard(board, "", "moving").map((x) => x.projectId),
  ["recent", "active"],
);
assert.deepEqual(
  filterMissionBoard(board, "", "unplanned").map((x) => x.projectId),
  ["planning", "recent", "active", "critical"],
  "projects without a roadmap also need planning even with a stated mission",
);
assert.deepEqual(
  filterMissionBoard(board, "", "complete").map((x) => x.projectId),
  ["done"],
);
assert.deepEqual(filterMissionBoard(board, "screen", "all").map((x) => x.projectId), ["active"]);
assert.deepEqual(filterMissionBoard(board, "CRITICAL", "all").map((x) => x.projectId), ["critical"]);
assert.deepEqual(
  filterMissionBoard(board, " unpatched ", "all").map((x) => x.projectId),
  ["critical"],
);

const page = readFileSync("src/app/(app)/missions/page.tsx", "utf8");
const view = readFileSync("src/components/missions/MissionsBoard.tsx", "utf8");
assert.match(page, /requirePageUserId\(\)/);
assert.match(page, /getProjects\(userId\)/);
assert.match(page, /getGoals\(userId\)/);
assert.match(page, /missionAlertFromProject\(project\)/);
assert.match(view, /type="search"/);
assert.match(view, /aria-pressed={filter === item.id}/);
assert.match(view, /min-h-11/);
assert.match(view, /lastDispatchAt\.slice\(0, 10\)/);
assert.doesNotMatch(view, /getProjects\(/);
assert.doesNotMatch(page + view, /export async function (POST|PATCH|PUT|DELETE)\(/);

console.log("✓ Missions board — truthful issues, filtering, recency and tenant-scoped data");
