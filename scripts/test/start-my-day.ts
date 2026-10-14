import assert from "node:assert/strict";
import {
  rankDayProjects,
  resolveDaySelection,
  type DayProjectInput,
} from "@/lib/start-my-day/rank";
import { DAY_MS } from "@/lib/constants/time";
import { MAX_CONCURRENT_BUILDING } from "@/lib/constants/control";

const now = Date.parse("2026-10-14T08:00:00Z");
const project = (
  id: string,
  ageDays = 1,
  patch: Partial<DayProjectInput> = {},
): DayProjectInput => ({
  id,
  name: id,
  href: "/control",
  runnable: true,
  paused: false,
  busy: false,
  activity: [{ at: new Date(now - ageDays * DAY_MS).toISOString(), source: "commit" }],
  ...patch,
});

const fleet = Array.from({ length: 30 }, (_, i) => project(`project-${i}`, i));
const plan = rankDayProjects(fleet, now);
assert.equal(plan.totalRecent, 8, "the seven-day cutoff is inclusive");
assert.equal(plan.projects.length, 7, "the home card never lists the whole fleet");
assert.equal(plan.selectedIds.length, MAX_CONCURRENT_BUILDING);
assert.deepEqual(plan.selectedIds, ["project-0", "project-1", "project-2"]);

const eligibility = rankDayProjects(
  [
    project("paused", 0, { paused: true }),
    project("busy", 0, { busy: true }),
    project("no-path", 0, { runnable: false }),
    project("working-choice", 2),
    project("last-week", 6),
    project("stale", 8),
    project("unknown", 0, { activity: [] }),
    project("invalid", 0, { activity: [{ at: "invalid", source: "run" }] }),
    project("future", -1),
  ],
  now,
);
assert.deepEqual(eligibility.selectedIds, ["working-choice", "last-week"]);
assert.equal(eligibility.totalRecent, 5);
assert.equal(
  eligibility.projects.find((p) => p.id === "paused")?.unavailable,
  "Paused for this project",
);
assert.equal(rankDayProjects([], now).selectedIds.length, 0);
assert.equal(rankDayProjects([project("old", 30)], now).projects.length, 0, "no stale fallback");

const mixed = rankDayProjects(
  [
    project("mixed", 30, {
      activity: [
        { at: new Date(now - 30 * DAY_MS).toISOString(), source: "dev log" },
        { at: new Date(now - DAY_MS).toISOString(), source: "session" },
        { at: new Date(now - 2 * DAY_MS).toISOString(), source: "commit" },
      ],
    }),
  ],
  now,
);
assert.match(mixed.projects[0].why, /Recent session/);
assert.equal(mixed.projects[0].lastActiveAt, "2026-10-13T08:00:00.000Z");
assert.deepEqual(
  rankDayProjects([project("b"), project("a")], now).selectedIds,
  ["a", "b"],
  "stable ties",
);

const owned = [
  { id: "loki", name: "Loki" },
  { id: "solon", name: "Solon" },
];
assert.deepEqual(resolveDaySelection(["solon", "loki"], owned), [owned[1], owned[0]]);
assert.equal(resolveDaySelection([], owned), null, "empty must not mean all");
assert.equal(resolveDaySelection(["loki", "loki"], owned), null, "no duplicate dispatch");
assert.equal(
  resolveDaySelection(["someone-elses-project"], owned),
  null,
  "ownership checked server-side",
);
assert.equal(
  resolveDaySelection(["loki", "deleted"], owned),
  null,
  "reject stale selection in full",
);
assert.equal(
  resolveDaySelection(
    fleet.map((p) => p.id),
    fleet,
  ),
  null,
  "budget cannot be bypassed by the client",
);

console.log("✓ start-my-day recency, eligibility, selection and scope tests passed");
