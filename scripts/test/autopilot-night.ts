/**
 * The autopilot night planner: a budget in runs, real reports before guesses,
 * one lane per project, stale reports filed away, one read when there is room.
 * Run: npx tsx scripts/test/autopilot-night.ts
 */
import assert from "node:assert/strict";
import {
  nightNoteText,
  nightRunsStarted,
  planNight,
  NIGHT_RUNS_MAX,
  READS_PER_NIGHT,
  STALE_REPORT_DAYS,
  STALE_REPORT_REASON,
  type NightProject,
  type NightReport,
} from "@/config/autopilot-night";

const NOW = Date.parse("2026-10-11T02:30:00Z");
const DAY = 24 * 60 * 60_000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

const project = (id: string, over: Partial<NightProject> = {}): NightProject => ({
  id,
  name: id,
  paused: false,
  runnable: true,
  readable: true,
  lastReadAt: null,
  busy: false,
  ...over,
});
const report = (id: string, projectId: string, over: Partial<NightReport> = {}): NightReport => ({
  id,
  projectId,
  createdAt: ago(1),
  duplicateCount: 1,
  source: "visitor",
  ...over,
});

// ── Stale reports are filed away, whatever the budget ────────────────────────
{
  const plan = planNight({
    budget: 0,
    projects: [project("a")],
    reports: [report("old", "a", { createdAt: ago(STALE_REPORT_DAYS + 1) }), report("new", "a")],
    now: NOW,
  });
  assert.deepEqual(plan.archive, [{ id: "old", reason: STALE_REPORT_REASON }]);
  assert.equal(plan.fixes.length, 0, "a budget of zero starts nothing");
  assert.equal(plan.reads.length, 0);
  assert.equal(plan.skipped.over_budget, 2, "the fix and the read both wanted a run");
}

// ── One lane per project; the owner's own note first, then what most hit ─────
{
  const plan = planNight({
    budget: 5,
    projects: [project("a"), project("b")],
    reports: [
      report("a-visitor", "a", { duplicateCount: 3 }),
      report("a-owner", "a", { source: "owner" }),
      report("a-ai", "a", { source: "ai_review", duplicateCount: 9 }),
      report("b-one", "b"),
    ],
    now: NOW,
  });
  assert.deepEqual(
    plan.fixes.map((f) => f.feedbackId),
    ["a-owner", "b-one"],
    "the owner's note wins its lane; the second project gets its own",
  );
  assert.equal(plan.skipped.lane_taken, 2);
}

// ── The budget is a hard cap, and the read comes after the fixes ─────────────
{
  const plan = planNight({
    budget: 2,
    projects: [project("a"), project("b"), project("c")],
    reports: [report("a1", "a"), report("b1", "b"), report("c1", "c")],
    now: NOW,
  });
  assert.equal(plan.fixes.length, 2);
  assert.equal(plan.reads.length, 0, "no room left for a read");
  assert.equal(plan.skipped.over_budget, 2, "the third fix, then the read");
}

// ── A read when there is room: longest-unread site, not one in a lane tonight ─
{
  const plan = planNight({
    budget: 3,
    projects: [
      project("a", { lastReadAt: ago(2) }),
      project("b", { lastReadAt: ago(9) }),
      project("c", { lastReadAt: ago(30) }),
    ],
    reports: [report("c1", "c")],
    now: NOW,
  });
  assert.deepEqual(plan.fixes, [{ feedbackId: "c1", projectId: "c" }]);
  assert.deepEqual(plan.reads, [{ projectId: "b" }], "c is in a lane, a was read this week");
  assert.equal(READS_PER_NIGHT, 1);
}

// ── Paused, busy and workspace-less projects take nothing ───────────────────
{
  const plan = planNight({
    budget: 9,
    projects: [
      project("p", { paused: true }),
      project("q", { busy: true }),
      project("r", { runnable: false, readable: false }),
    ],
    reports: [report("p1", "p"), report("q1", "q"), report("r1", "r")],
    now: NOW,
  });
  assert.equal(plan.fixes.length, 0);
  assert.equal(plan.reads.length, 0);
  assert.deepEqual(plan.skipped, {
    paused: 1,
    busy: 1,
    not_runnable: 1,
    lane_taken: 0,
    over_budget: 0,
  });
}

// ── The setting cannot exceed the ceiling ────────────────────────────────────
{
  const projects = Array.from({ length: 30 }, (_, i) => project(`p${i}`));
  const plan = planNight({
    budget: 999,
    projects,
    reports: projects.map((p) => report(`r-${p.id}`, p.id)),
    now: NOW,
  });
  assert.equal(plan.fixes.length, NIGHT_RUNS_MAX);
}

// ── The morning note: one sentence, or nothing ──────────────────────────────
{
  const quiet = nightNoteText({
    budget: 4,
    fixes: [{ feedbackId: "x", projectName: "a", runId: null }],
    reads: [],
    archived: 0,
    rerouted: 0,
    skipped: { paused: 0, busy: 0, not_runnable: 0, lane_taken: 0, over_budget: 0 },
  });
  assert.equal(quiet, null, "a fix that did not start is not news");

  const summary = {
    budget: 4,
    fixes: [
      { feedbackId: "x", projectName: "kestrel", runId: "r1" },
      { feedbackId: "y", projectName: "harbourlight", runId: "r2" },
    ],
    reads: [{ projectName: "ledgerpost", runId: "r3" }],
    archived: 4,
    rerouted: 0,
    skipped: { paused: 0, busy: 0, not_runnable: 0, lane_taken: 0, over_budget: 0 },
  };
  assert.equal(nightRunsStarted(summary), 3);
  assert.equal(
    nightNoteText(summary, 1.2),
    "Last night Loki started 2 fixes (kestrel, harbourlight), read ledgerpost, filed away 4 old reports · 3 of 4 runs · $1.20.",
  );
  assert.equal(
    nightNoteText({ ...summary, fixes: [], reads: [], archived: 1 }),
    "Last night Loki filed away 1 old report · 0 of 4 runs.",
  );
}

console.log("✓ autopilot night planner tests passed");
