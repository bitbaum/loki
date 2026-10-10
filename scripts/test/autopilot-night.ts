/**
 * The autopilot night planner: a budget in runs, real reports before guesses,
 * one lane per project, stale reports filed away, one read when there is room.
 * Run: npx tsx scripts/test/autopilot-night.ts
 */
import assert from "node:assert/strict";
import {
  nightActionTitle,
  nightAllowance,
  estimateNightCost,
  estimateText,
  nightProposalText,
  nightNoteText,
  nightRunsStarted,
  planNight,
  NIGHT_RUNS_MAX,
  READS_PER_NIGHT,
  STALE_REPORT_DAYS,
  STALE_REPORT_REASON,
  type NightProject,
  type NightReport,
  NIGHT_APPROVAL,
  allowanceDaysLeft,
  nightRunAt,
  upcomingNight,
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

// ── The evening: what it would cost, honestly ────────────────────────────────
{
  const none = estimateNightCost([], 3);
  assert.equal(none.totalUsd, null);
  assert.equal(estimateText(none), "no past runs to estimate from");

  const subscription = estimateNightCost(
    [
      { adapter: "claude", costUsd: null, tokensIn: null, tokensOut: null },
      { adapter: "claude", costUsd: null, tokensIn: null, tokensOut: null },
    ],
    2,
  );
  assert.equal(subscription.totalUsd, null);
  assert.match(estimateText(subscription), /no metered cost/);

  const metered = estimateNightCost(
    [
      { adapter: "codex", costUsd: 0.4, tokensIn: 100_000, tokensOut: 5_000 },
      { adapter: "codex", costUsd: 0.8, tokensIn: 200_000, tokensOut: 7_000 },
      { adapter: "claude", costUsd: null, tokensIn: null, tokensOut: null },
    ],
    3,
  );
  assert.equal(metered.perRunUsd, 0.6);
  assert.equal(metered.totalUsd, 1.8);
  assert.equal(metered.perRunTokens, 156_000);
  assert.equal(metered.sample, 3);
  assert.equal(
    estimateText(metered),
    "~$1.80 (your last 3 runs averaged $0.60, ~156k tokens a run)",
  );

  const text = nightProposalText(
    {
      night: "2026-10-11",
      budget: 4,
      fixes: [
        { feedbackId: "a", projectName: "kestrel", excerpt: "prices unreadable" },
        { feedbackId: "b", projectName: "harbourlight", excerpt: "footer year" },
      ],
      reads: [{ projectId: "c", projectName: "ledgerpost" }],
      archive: 2,
      skipped: { paused: 0, busy: 0, not_runnable: 0, lane_taken: 0, over_budget: 0 },
    },
    metered,
  );
  assert.equal(
    text,
    "Tonight Loki would start 2 fixes (kestrel, harbourlight) and read ledgerpost — 3 of 4 runs, ~$1.80 (your last 3 runs averaged $0.60, ~156k tokens a run). Filing away 2 old reports is free and one tap to undo.",
  );
  const quiet = nightProposalText(
    {
      night: "2026-10-11",
      budget: 4,
      fixes: [],
      reads: [],
      archive: 0,
      skipped: { paused: 0, busy: 0, not_runnable: 0, lane_taken: 0, over_budget: 0 },
    },
    none,
  );
  assert.match(quiet, /nothing to build/);
}

// ── The allowance: the only way a night runs unasked ────────────────────────
{
  const now = Date.parse("2026-10-10T19:00:00Z");
  const metered = { runs: 3, totalUsd: 1.8, perRunUsd: 0.6, perRunTokens: null, sample: 3 };
  const unmetered = { runs: 3, totalUsd: null, perRunUsd: null, perRunTokens: null, sample: 3 };
  const none = nightAllowance({ night_allow_until: null, night_cost_cap_usd: null }, metered, now);
  assert.equal(none.auto, false);
  const expired = nightAllowance(
    { night_allow_until: "2026-10-01T00:00:00Z", night_cost_cap_usd: null },
    metered,
    now,
  );
  assert.equal(expired.auto, false, "an allowance that ran out asks again");
  const over = nightAllowance(
    { night_allow_until: "2026-10-17T00:00:00Z", night_cost_cap_usd: 1 },
    metered,
    now,
  );
  assert.equal(over.auto, false);
  assert.match(over.reason, /over your \$1\.00 cap/);
  const ok = nightAllowance(
    { night_allow_until: "2026-10-17T00:00:00Z", night_cost_cap_usd: 5 },
    metered,
    now,
  );
  assert.deepEqual(ok, { auto: true, reason: "allowed until 2026-10-17, up to $5.00 a night" });
  const free = nightAllowance(
    { night_allow_until: "2026-10-17T00:00:00Z", night_cost_cap_usd: 1 },
    unmetered,
    now,
  );
  assert.equal(free.auto, true, "an unmetered builder cannot exceed a cap");
  assert.equal(nightActionTitle("2026-10-11"), "Tonight's autopilot plan · 2026-10-11");
}

// ── The night that was not approved says so; the clock names the right night ─
{
  const held = nightNoteText({
    budget: 4,
    approval: NIGHT_APPROVAL.NOT_APPROVED,
    fixes: [],
    reads: [],
    archived: 2,
    rerouted: 0,
    skipped: { paused: 0, busy: 0, not_runnable: 0, lane_taken: 0, over_budget: 0 },
  });
  assert.equal(
    held,
    "Last night Loki built nothing (tonight's plan was not approved), filed away 2 old reports · 0 of 4 runs.",
  );
  assert.equal(
    nightNoteText({
      budget: 4,
      approval: NIGHT_APPROVAL.NOTHING_PLANNED,
      fixes: [],
      reads: [],
      archived: 0,
      rerouted: 0,
      skipped: { paused: 0, busy: 0, not_runnable: 0, lane_taken: 0, over_budget: 0 },
    }),
    null,
    "nothing planned, nothing done: silence",
  );

  const refused = nightNoteText({
    budget: 4,
    approval: NIGHT_APPROVAL.APPROVED,
    fixes: [
      {
        feedbackId: "a",
        projectName: "kestrel",
        runId: null,
        why: "Injection failed: no builder online. Connect Fleet Runner on this computer to run agent work.",
      },
    ],
    reads: [],
    archived: 0,
    rerouted: 0,
    skipped: { paused: 0, busy: 0, not_runnable: 0, lane_taken: 0, over_budget: 0 },
  });
  assert.equal(
    refused,
    "Last night Loki could not start the 1 run you approved (no builder online) · 0 of 4 runs.",
    "a yes that led nowhere is not a silent morning",
  );

  // 19:00 UTC on the 10th plans for the run on the morning of the 11th; a
  // replay at 01:00 on the 11th still names the 11th; 03:00 is the next night.
  assert.equal(upcomingNight(new Date("2026-10-10T19:00:00Z")), "2026-10-11");
  assert.equal(upcomingNight(new Date("2026-10-11T01:00:00Z")), "2026-10-11");
  assert.equal(upcomingNight(new Date("2026-10-11T03:00:00Z")), "2026-10-12");
  assert.equal(nightRunAt("2026-10-11").toISOString(), "2026-10-11T02:30:00.000Z");

  const now = Date.parse("2026-10-10T12:00:00Z");
  const days = (n: number) => new Date(now + n * 86_400_000).toISOString();
  assert.equal(allowanceDaysLeft(null, now), 0);
  assert.equal(allowanceDaysLeft(days(-1), now), 0, "an expired allowance reads as ask me");
  assert.equal(allowanceDaysLeft(days(7), now), 7);
  assert.equal(allowanceDaysLeft(days(6.5), now), 7, "a week set half a day ago is still a week");
  assert.equal(allowanceDaysLeft(days(2), now), 7, "less than the shortest choice rounds up to it");
  assert.equal(allowanceDaysLeft(days(30), now), 30);
  assert.equal(allowanceDaysLeft(days(45), now), 30);
  assert.equal(allowanceDaysLeft(days(365), now), 90);
}

console.log("✓ autopilot night planner tests passed");
