/**
 * The telemetry freshness monitor, and the config it reads.
 * Run: npx tsx scripts/test/telemetry-freshness.ts
 *
 * Two halves:
 *
 * 1. BEHAVIOUR — the four states are genuinely distinct. The one that matters
 *    most is UNCHECKED: a monitor that reports "could not look" as "fine" is
 *    worse than no monitor, because it emits a ✓ while blind. Half these
 *    assertions exist to stop that specific collapse.
 *
 * 2. CONFIG INTEGRITY — the config cannot quietly stop describing reality:
 *    every table/column it names must exist in the Drizzle schema, and every
 *    cron its budgets ASSUME is running must actually be scheduled. Both are
 *    derived from other files, so neither can rot into agreement with itself.
 *
 * Env-independent by construction: the reader is injected, so nothing here
 * needs DATABASE_URL (`checkTelemetryFreshness`'s real reader imports @/db
 * lazily for exactly this reason).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TELEMETRY_PATHS,
  MONITORED_PATHS,
  type TelemetryPath,
} from "../../src/config/telemetry-paths";
import {
  checkTelemetryFreshness,
  describeBroken,
  humanizeAge,
  type PathReading,
} from "../../src/lib/telemetry-freshness";

const path = (over: Partial<TelemetryPath> = {}): TelemetryPath =>
  ({
    table: "t_test",
    timeColumn: "created_at",
    label: "Test path",
    writer: "a test",
    monitored: true,
    maxSilenceHours: 24,
    because: "test",
    ...over,
  }) as TelemetryPath;

const reading = (over: Partial<PathReading> = {}): PathReading => ({
  rows: 100,
  newest: "2026-08-26T00:00:00Z",
  ageHours: 1,
  ...over,
});

// Wrapped in main(): tsx transpiles these scripts to CJS, which has no
// top-level await.
async function main() {
  // ── 1. FLOWING: a row inside budget ──────────────────────────────────────────
  {
    const r = await checkTelemetryFreshness(async () => reading({ ageHours: 5 }), [path()]);
    assert.equal(r.results[0].state, "flowing");
    assert.deepEqual(r.broken, [], "a fresh path must not be reported broken");
    assert.equal(r.flowingCount, 1);
  }

  // ── 2. STALE: rows exist, newest is past the budget ──────────────────────────
  {
    const r = await checkTelemetryFreshness(async () => reading({ ageHours: 25 }), [path()]);
    assert.equal(r.results[0].state, "stale");
    assert.equal(r.broken.length, 1, "a path past its budget must be actionable");
  }

  // Boundary: exactly at the budget is still fine; one hair past is not. Asserted
  // because an off-by-one here shows up as an alert that fires a day early, every
  // day, on a healthy system — and that is how a monitor gets muted.
  {
    const at = await checkTelemetryFreshness(async () => reading({ ageHours: 24 }), [path()]);
    assert.equal(at.results[0].state, "flowing", "age == budget must not alert");
    const over = await checkTelemetryFreshness(async () => reading({ ageHours: 24.01 }), [path()]);
    assert.equal(over.results[0].state, "stale", "age > budget must alert");
  }

  // ── 3. SILENT: never carried a row — a DIFFERENT fault from stale ────────────
  {
    const r = await checkTelemetryFreshness(
      async () => reading({ rows: 0, newest: null, ageHours: null }),
      [path()],
    );
    assert.equal(r.results[0].state, "silent");
    assert.equal(r.broken.length, 1, "a monitored path with no rows is still broken");
    assert.match(
      describeBroken(r),
      /NEVER carried a row/,
      "silent and stale must not share wording — they have different fixes",
    );
  }

  // ── 4. UNCHECKED: the read failed. NOT a pass, NOT a fault ───────────────────
  // This is the assertion the whole file exists for.
  {
    const nulled = await checkTelemetryFreshness(async () => null, [path()]);
    assert.equal(nulled.results[0].state, "unchecked");
    assert.equal(nulled.flowingCount, 0, "an unreadable path must never count as flowing");
    assert.deepEqual(
      nulled.broken,
      [],
      "an unreadable path must not be reported as a fault either",
    );
    assert.equal(nulled.unchecked.length, 1, "it must be reported as unchecked, loudly");

    const threw = await checkTelemetryFreshness(async () => {
      throw new Error("db exploded");
    }, [path()]);
    assert.equal(threw.results[0].state, "unchecked", "a THROWN read is also 'could not look'");
    assert.match(
      threw.results[0].error ?? "",
      /db exploded/,
      "the reason must survive to the operator",
    );
  }

  // A failing read must not take the other paths down with it — one dead query
  // would otherwise blind the whole check.
  {
    const r = await checkTelemetryFreshness(
      async (p) => (p.table === "bad" ? null : reading({ ageHours: 1 })),
      [path({ table: "bad" }), path({ table: "good" })],
    );
    assert.equal(r.unchecked.length, 1);
    assert.equal(
      r.flowingCount,
      1,
      "a healthy path must still be reported when a sibling read fails",
    );
  }

  // ── 5. Demand paths are never reported broken, however old ──────────────────
  // The noise-control property: if this breaks, the monitor starts crying about
  // `captures` every day and gets muted, taking the real signal with it.
  {
    const r = await checkTelemetryFreshness(
      async () => reading({ ageHours: 24 * 365 }),
      [path({ monitored: false, because: "demand" } as Partial<TelemetryPath>)],
    );
    assert.deepEqual(r.broken, [], "a demand-driven path must never page anyone");

    // ...and must not be DESCRIBED as healthy either. beacon_sessions last saw a
    // row 78 days ago; reporting that as "flowing", or tallying it into a
    // "12 paths healthy" summary, is the same species of lie this module exists
    // to catch — a reassuring sentence built from a number nobody checked.
    assert.equal(
      r.results[0].state,
      "ondemand",
      "an unmonitored path must not claim to be flowing",
    );
    assert.equal(r.flowingCount, 0, "flowingCount must count MONITORED paths only");
    assert.equal(
      r.monitoredCount,
      0,
      "monitoredCount is the denominator — no monitored paths here",
    );
  }

  // ── 6. humanizeAge stays readable at every scale ─────────────────────────────
  assert.equal(humanizeAge(null), "never");
  assert.equal(humanizeAge(0.5), "30m");
  assert.equal(humanizeAge(5), "5.0h");
  assert.equal(humanizeAge(24 * 76), "76d");

  // ── 7. Config: every table/column must exist in the Drizzle schema ──────────
  // Direction that prevents rot: rename a column and the sensor would silently
  // query nothing forever. Schema is imported for its metadata only — no DB.
  {
    const { getTableColumns, getTableName, is } = await import("drizzle-orm");
    const { PgTable } = await import("drizzle-orm/pg-core");
    const schema = await import("../../src/db/schema");

    const cols = new Map<string, Set<string>>();
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      cols.set(
        getTableName(value),
        new Set(Object.values(getTableColumns(value)).map((c) => (c as { name: string }).name)),
      );
    }
    assert.ok(
      cols.size > 20,
      `expected many schema tables, found ${cols.size} — has the schema moved?`,
    );

    for (const p of TELEMETRY_PATHS) {
      const table = cols.get(p.table);
      assert.ok(
        table,
        `telemetry path "${p.table}" is not in the Drizzle schema — renamed or dropped?`,
      );
      assert.ok(
        table.has(p.timeColumn),
        `${p.table}.${p.timeColumn} does not exist — the freshness query would read nothing, forever`,
      );
    }
  }

  // ── 8. Config: every cron a budget ASSUMES is running must be scheduled ─────
  {
    const installer = readFileSync("scripts/install-hetzner-crons.sh", "utf8");
    const schedLine = installer.split("\n").find((l) => l.includes("declare -A SCHED="));
    assert.ok(schedLine, "no 'declare -A SCHED=' line — the cron schedule table moved");
    const scheduled = new Set([...schedLine.matchAll(/\[([a-z0-9-]+)\]=/g)].map((m) => m[1]));

    for (const p of MONITORED_PATHS) {
      for (const cron of p.writerCrons ?? []) {
        assert.ok(
          scheduled.has(cron),
          `${p.table}'s budget assumes cron "${cron}" runs, but it has no timer. ` +
            `Either restore the timer or re-derive maxSilenceHours from what actually writes.`,
        );
      }
    }

    // The monitor must monitor itself: unschedule this and nothing else notices.
    assert.ok(
      scheduled.has("check-telemetry"),
      "check-telemetry has no timer — the monitor would never run",
    );
  }

  // ── 9. Config invariants ────────────────────────────────────────────────────
  {
    const seen = new Set<string>();
    for (const p of TELEMETRY_PATHS) {
      assert.ok(!seen.has(p.table), `duplicate telemetry path for ${p.table}`);
      seen.add(p.table);
      assert.ok(
        p.writer.trim().length > 0,
        `${p.table} names no writer — nobody could fix it when it goes quiet`,
      );
      assert.ok(p.because.trim().length > 10, `${p.table} has no stated reason`);
      if (p.monitored) {
        assert.ok(
          p.maxSilenceHours > 0,
          `${p.table} has a non-positive budget — it would alert always or never`,
        );
      }
    }
    // 2, not 3, since 2026-09-25: frontier_digests was demoted ON PURPOSE when
    // its daily cron was removed (a timer may not spend the shared free AI
    // tier) — see its entry in telemetry-paths.ts. Lower this again only with
    // the same kind of stated reason.
    assert.ok(
      MONITORED_PATHS.length >= 2,
      "fewer than 2 monitored paths — did a sensor get quietly demoted?",
    );

    // Named explicitly: a generic count assertion would still pass if the path
    // this whole check was written for were dropped from the list.
    const monitored = MONITORED_PATHS.map((p) => p.table);
    assert.ok(
      monitored.includes("claude_code_history"),
      "claude_code_history is no longer monitored — the 76-day silent outage becomes invisible again",
    );
    assert.ok(
      monitored.includes("debug_logs"),
      "debug_logs is no longer monitored — the cron canary is gone",
    );
  }

  console.log(
    `✓ telemetry freshness: states distinct (unchecked ≠ pass, ondemand ≠ flowing), ` +
      `${MONITORED_PATHS.length} monitored / ${TELEMETRY_PATHS.length} paths, ` +
      `all tables+columns in schema, all writer crons scheduled`,
  );
}

void main();
