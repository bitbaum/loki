/**
 * SSOT for the fleet's telemetry paths — and, for each, whether SILENCE IS A FAULT.
 *
 * ── The class this exists to close ───────────────────────────────────────────
 * `claude_code_history` carried 31,284 rows and then stopped on 2026-06-10. It
 * was still stopped 76 days later, when this file was written. Nothing noticed,
 * because nothing was looking: Fleet Doctor checked that the TABLE EXISTS, the
 * ingest script swallowed its own failures, and /activity kept rendering — just
 * with a hole in it. Every check in the system could pass while the sensor was
 * dead, because existence is not function.
 *
 * A sensor without a self-test is already lying. The only proof a telemetry
 * path works is a RECENT ROW.
 *
 * ── Why a path list and not "check every table" ──────────────────────────────
 * Most tables here are written by a HUMAN doing something. `ai_spend` is a
 * per-(user,day) rollup of Loki chat turns: three rows means three days anyone
 * chatted, not a broken ledger. `captures` has never held a row. Alerting on
 * those would manufacture permanent noise, and permanent noise is how a real
 * alert gets ignored — the exact failure this file is meant to prevent.
 *
 * So each path declares WHO writes it. A path with an automatic writer on a
 * known cadence is `monitored`: its silence is provably a fault. A path written
 * on demand is not monitored, and says why. Both halves are stated, because a
 * path nobody can name a writer for is a path nobody can fix when it goes quiet.
 *
 * ── Where the budgets come from ──────────────────────────────────────────────
 * Measured against 90 days of production history, not guessed. Each entry
 * carries the observation that justifies its number, so the next person can
 * check the reasoning instead of inheriting a magic constant.
 */

/** A path whose silence means something is broken. */
type MonitoredPath = {
  monitored: true;
  /** Longest silence that is still normal. Exceeded ⇒ alert. */
  maxSilenceHours: number;
  /** The measurement or contract behind `maxSilenceHours`. */
  because: string;
  /**
   * Cron job names this path's budget ASSUMES are running (from the SCHED table
   * in scripts/install-hetzner-crons.sh). A test asserts each one is actually
   * scheduled — because a budget justified by "these run hourly" quietly stops
   * being justified the day one of them is unscheduled, and the monitor would
   * then either alert forever or, worse, be widened to make the noise stop.
   *
   * Absent when no cron feeds the path — which is itself worth seeing.
   */
  writerCrons?: string[];
};

/** A path whose silence is information, not a fault. */
type DemandPath = {
  monitored: false;
  /** Why nobody should be paged when this goes quiet. */
  because: string;
};

export type TelemetryPath = {
  /** Postgres table name — must match the Drizzle schema (a test enforces it). */
  table: string;
  /** Column holding the EVENT time. Not `updated_at`: a row touched by a
   *  backfill would otherwise read as fresh traffic. */
  timeColumn: string;
  /** What a human sees in the alert and in Fleet Doctor. */
  label: string;
  /** What writes rows here. Named so a silent path has an obvious first suspect. */
  writer: string;
} & (MonitoredPath | DemandPath);

export const TELEMETRY_PATHS: TelemetryPath[] = [
  // ── Monitored: an automatic writer on a known cadence ──────────────────────
  {
    table: "debug_logs",
    timeColumn: "created_at",
    label: "Cron heartbeat",
    writer: "every cron route via logDebug() — six run hourly (:05, :10, :15, :25, :30, :45)",
    monitored: true,
    maxSilenceHours: 12,
    because:
      "Three hourly crons make a row every 15–45 minutes a CONTRACT, so 12h is " +
      "24× the expected interval. The budget comes from that contract rather " +
      "than from history on purpose: prune-debug-logs keeps only 30 days of " +
      "info/warn rows, so the 6-day 'worst gap' visible in a 90-day window is a " +
      "PRUNING ARTIFACT, not an outage. Measuring here would have set the budget " +
      "from the janitor's behaviour instead of the writers'. " +
      "This is also the fleet's canary: silence means the cron runner itself is " +
      "dead, which takes every other scheduled check down with it — including " +
      "the model-rot check and this one.",
    writerCrons: ["reap-stale-runs", "check-runner-stall", "check-pending-approvals"],
  },
  {
    table: "claude_code_history",
    timeColumn: "occurred_at",
    label: "Local agent transcript ingest",
    writer: "scripts/ingest-claude-code-history.ts, tailing ~/.claude/projects/*.jsonl",
    monitored: true,
    maxSilenceHours: 48,
    because:
      "Measured over 90 days: p99 gap 8m47s, worst-ever gap 17h58m. 48h is 2.7× " +
      "the worst NORMAL silence, so a false positive needs an unprecedented quiet " +
      "spell. It was 76 DAYS stale when this check was written — 100× that worst " +
      "gap — which is how far a path can drift when nothing measures it.\n" +
      "NOTE: no `writerCrons`, and that is the root cause rather than an " +
      "oversight. Its only writer is a script a human must remember to run, on " +
      "a machine the box cannot reach — which is not automation, it is a habit. " +
      "This check cannot restart the ingest; it can only stop the silence from " +
      "being mistaken for calm.",
  },
  {
    table: "frontier_digests",
    timeColumn: "generated_at",
    label: "Frontier digest",
    writer: "none scheduled — the daily cron was removed 2026-09-25",
    monitored: false,
    because:
      "It was a daily cron that called the free models with nobody asking, and " +
      "a timer may not spend the shared free tier. Nothing writes this table on " +
      "a clock any more, so its silence is expected, not a fault.",
  },

  // ── Demand-driven: silence is information, not a fault ─────────────────────
  {
    table: "prompt_history",
    timeColumn: "dispatched_at",
    label: "Dispatch ledger",
    writer: "a dispatch from /control, Loki, or autopilot",
    monitored: false,
    because:
      "Written when someone dispatches. Measured worst normal gap: 9d18h. A quiet " +
      "week is a quiet week, not an outage.",
  },
  {
    table: "orchestration_runs",
    timeColumn: "created_at",
    label: "Orchestration runs",
    writer: "a dispatched run",
    monitored: false,
    because: "Dispatch-driven; measured worst normal gap 4d0h.",
  },
  {
    table: "run_events",
    timeColumn: "created_at",
    label: "Run events",
    writer: "a run in progress",
    monitored: false,
    because: "Only exists while runs exist; empty stretches are normal.",
  },
  {
    table: "orchestration_events",
    timeColumn: "created_at",
    label: "Orchestration events",
    writer: "orchestration state transitions",
    monitored: false,
    because: "Dispatch-driven; measured worst normal gap 6d3h.",
  },
  {
    table: "control_audit_events",
    timeColumn: "created_at",
    label: "Control audit trail",
    writer: "an operator acting on /control",
    monitored: false,
    because: "Human-driven; measured worst normal gap 7d7h.",
  },
  {
    table: "agent_sessions",
    timeColumn: "updated_at",
    label: "Agent sessions",
    writer: "an agent session opening or reporting in",
    monitored: false,
    because:
      "Session-driven, and its only timestamp is updated_at — a mutable " +
      "column, so freshness here cannot distinguish new traffic from a touch.",
  },
  {
    table: "ai_spend",
    timeColumn: "updated_at",
    label: "AI budget ledger",
    writer: "recordSpend() after a Loki chat turn",
    monitored: false,
    because:
      "A per-(user,day) ROLLUP, not an event log: one row per person per day " +
      "they chatted. Three rows means three such days, which is a usage fact " +
      "about a single-operator fleet, not a broken ledger.",
  },
  {
    table: "captures",
    timeColumn: "created_at",
    label: "Captures",
    writer: "the capture API, when a user saves one",
    monitored: false,
    because:
      "Has never held a row. Monitoring an unused feature would alert " + "daily about nothing.",
  },
];

/** Paths whose silence should raise an alert. */
export const MONITORED_PATHS = TELEMETRY_PATHS.filter(
  (p): p is TelemetryPath & MonitoredPath => p.monitored,
);
