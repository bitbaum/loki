/**
 * A reaped `partial` run must say what happened.
 *
 * The reaper stamps `partial` on exactly one basis — proof that the agent DID
 * save a handoff inside the run window — and then copied none of it, leaving
 * `summary` NULL. Prod 2026-09-20: 8 of the last 12 closed runs on `loki` were
 * reaped partials with an entirely empty summary, on a ~6-hour cadence. Since
 * `done`/`next` are what the dossier re-serves to the NEXT dispatch, each run
 * was briefed with less than the previous one knew.
 *
 * These tests pin the three refusals and the one wiring fact, because the bug
 * was never a wrong value — it was a value nobody carried.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { summaryFromHandoff, type SessionHandoffRow } from "../../src/lib/orchestration/summary";
import { DOD_EVIDENCE_FIELDS } from "../../src/lib/orchestration/dod-gate";

const root = join(import.meta.dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const START = Date.parse("2026-09-20T10:00:00Z");

const handoff = (over: Partial<SessionHandoffRow> = {}): SessionHandoffRow => ({
  status: "ready",
  tsc: "pass",
  lint: "pass",
  tests: "216 pass · 0 fail",
  todos: "15",
  done: "Fixed the thing",
  next: "",
  commit: "abc1234",
  health: "good",
  blockReason: null,
  noOpCount: null,
  writtenAtMs: START + 60_000,
  ...over,
});

// --- 1. a handoff inside the window is carried onto the run ---------------
{
  const summary = summaryFromHandoff(handoff(), START);
  assert.ok(summary, "a handoff written after the run started must produce a summary");
  assert.equal(summary.done, "Fixed the thing");
  assert.equal(summary.tests, "216 pass · 0 fail");
  assert.equal(summary.commit, "abc1234");
  assert.equal(summary.health, "good");
}

// --- 2. every field the DoD judge can read survives the trip --------------
// `tsc`/`lint`/`commit` were in the judge's prompt while NO layer carried them
// (56 runs, filled ZERO times) and `block-reason`/`no-op-count` were in the
// contract while nothing persisted them. Both bugs were a dropped field on one
// path, so assert this path drops none of them.
{
  const summary = summaryFromHandoff(handoff({ next: "resume from X" }), START);
  assert.ok(summary);
  for (const [field] of DOD_EVIDENCE_FIELDS) {
    assert.ok(
      String((summary as Record<string, unknown>)[field as string] ?? "").trim() !== "",
      `DoD evidence field "${String(field)}" is dropped between the handoff and the run summary`,
    );
  }
}

// --- 3. a handoff predating delivery belongs to another run ---------------
// Same floor as closeRunFromSession and the reaper's own wroteAfterStart: the
// gap between the sweep and this pass must not let a later run's handoff — or
// an older one — be pinned onto this run.
{
  assert.equal(
    summaryFromHandoff(handoff({ writtenAtMs: START - 1 }), START),
    null,
    "a handoff written before the run's effective start must never be attached",
  );
  assert.equal(
    summaryFromHandoff(handoff({ writtenAtMs: START }), START),
    null,
    "the floor is strict: a handoff exactly at the start is not proof of this run's work",
  );
}

// --- 4. an empty handoff stays NULL, not an empty form --------------------
{
  const blank = summaryFromHandoff(
    handoff({
      status: null,
      tsc: null,
      lint: null,
      tests: null,
      todos: null,
      done: null,
      next: null,
      commit: null,
      health: null,
    }),
    START,
  );
  assert.equal(
    blank,
    null,
    "an all-blank handoff must leave summary NULL rather than write an empty form that reads as a deliberate report of nothing",
  );
}

// --- 5. the reaper actually calls it --------------------------------------
// The whole defect was a value nobody carried, so a module that exists and is
// never invoked reproduces it exactly.
{
  const reaper = read("src/db/queries/orchestration-runs.ts");
  assert.ok(
    reaper.includes("attachHandoffToReapedPartials"),
    "reapStaleRuns must call attachHandoffToReapedPartials, or reaped partials stay summary-less",
  );
}

console.log("reap-handoff: all assertions passed");
