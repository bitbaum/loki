// Pins runsEndedByRestart + parseBootedAt — the rule that closes open runs the
// moment a runner reports it restarted, instead of an hour later (2026-09-25:
// a Skif run killed with loki-box-runner at 10:53 read `waiting` until 11:40).
//
// The dangerous direction is a FALSE POSITIVE: closing a run the new runner is
// about to claim, or has just started, drops real work. So every "leave it"
// case is asserted as loudly as the positive one.
import {
  parseBootedAt,
  runnerRestartReason,
  runsEndedByRestart,
  type OpenRunRestartFacts,
} from "@/lib/orchestration/runner-restart";

const NOW = Date.parse("2026-09-25T11:00:00Z");
const BOOT = Date.parse("2026-09-25T10:53:00Z");
const MIN = 60_000;

let pass = 0;
const cases: Array<[string, boolean]> = [];
const check = (name: string, cond: boolean) => {
  cases.push([name, cond]);
  if (cond) pass++;
};

const run = (over: Partial<OpenRunRestartFacts> & { id: string }): OpenRunRestartFacts => ({
  channel: "cloud",
  firstSessionEventAtMs: null,
  lastSessionEventAtMs: null,
  hasOutstandingCommand: false,
  ...over,
});
const ended = (runs: OpenRunRestartFacts[], channel = "cloud") =>
  runsEndedByRestart(runs, { bootedAtMs: BOOT, channel });

// ── Closed ──────────────────────────────────────────────────────────────────
check(
  "claimed before boot, nothing since ⇒ closed",
  ended([
    run({ id: "a", firstSessionEventAtMs: BOOT - 13 * MIN, lastSessionEventAtMs: BOOT - 13 * MIN }),
  ]).includes("a"),
);
check(
  "generating/progress before boot ⇒ closed",
  ended([
    run({ id: "a", firstSessionEventAtMs: BOOT - 10 * MIN, lastSessionEventAtMs: BOOT - 1000 }),
  ]).includes("a"),
);

// ── Left alone ──────────────────────────────────────────────────────────────
check(
  "only dispatched (no session event at all) ⇒ NOT closed — the new runner claims it",
  ended([run({ id: "q" })]).length === 0,
);
check(
  "first session event after boot ⇒ NOT closed",
  ended([run({ id: "n", firstSessionEventAtMs: BOOT + 5000, lastSessionEventAtMs: BOOT + 9000 })])
    .length === 0,
);
check(
  "session event exactly at boot ⇒ NOT closed (strictly before)",
  ended([run({ id: "n", firstSessionEventAtMs: BOOT, lastSessionEventAtMs: BOOT })]).length === 0,
);
check(
  "worked before boot but heard from AFTER boot ⇒ NOT closed (a live runner has it)",
  ended([
    run({ id: "s", firstSessionEventAtMs: BOOT - 5 * MIN, lastSessionEventAtMs: BOOT + 3000 }),
  ]).length === 0,
);
check(
  "claimed before boot but its command is still un-acked ⇒ NOT closed (it is reclaimed and re-run)",
  ended([
    run({
      id: "r",
      firstSessionEventAtMs: BOOT - 5 * MIN,
      lastSessionEventAtMs: BOOT - 5 * MIN,
      hasOutstandingCommand: true,
    }),
  ]).length === 0,
);
check(
  "run on the OTHER channel ⇒ NOT closed",
  ended(
    [
      run({
        id: "l",
        channel: "local",
        firstSessionEventAtMs: BOOT - MIN,
        lastSessionEventAtMs: BOOT - MIN,
      }),
    ],
    "cloud",
  ).length === 0,
);
check(
  "run with no recorded channel ⇒ NOT closed (proves nothing about this runner)",
  ended([
    run({
      id: "x",
      channel: null,
      firstSessionEventAtMs: BOOT - MIN,
      lastSessionEventAtMs: BOOT - MIN,
    }),
  ]).length === 0,
);

// ── Mixed batch: exactly the ended run ──────────────────────────────────────
{
  const out = ended([
    run({ id: "dead", firstSessionEventAtMs: BOOT - 13 * MIN, lastSessionEventAtMs: BOOT - MIN }),
    run({ id: "queued" }),
    run({ id: "fresh", firstSessionEventAtMs: BOOT + 1000, lastSessionEventAtMs: BOOT + 1000 }),
  ]);
  check("mixed batch ⇒ only the dead run", out.length === 1 && out[0] === "dead");
}

// ── bootedAt parsing: anything doubtful closes nothing ──────────────────────
check("valid bootedAt ⇒ accepted", parseBootedAt(BOOT, NOW) === BOOT);
check("missing bootedAt ⇒ null", parseBootedAt(undefined, NOW) === null);
check("string bootedAt ⇒ null", parseBootedAt(String(BOOT), NOW) === null);
check("NaN bootedAt ⇒ null", parseBootedAt(Number.NaN, NOW) === null);
check("Infinity bootedAt ⇒ null", parseBootedAt(Number.POSITIVE_INFINITY, NOW) === null);
check(
  "zero/negative bootedAt ⇒ null",
  parseBootedAt(0, NOW) === null && parseBootedAt(-5, NOW) === null,
);
check("future bootedAt (an hour ahead) ⇒ null", parseBootedAt(NOW + 60 * MIN, NOW) === null);
check(
  "slight runner clock lead (30s) ⇒ tolerated",
  parseBootedAt(NOW + 30_000, NOW) === NOW + 30_000,
);
check("bootedAt older than 7 days ⇒ null", parseBootedAt(NOW - 8 * 24 * 60 * MIN, NOW) === null);
check(
  "bootedAt in SECONDS (unit bug) ⇒ null",
  parseBootedAt(Math.floor(BOOT / 1000), NOW) === null,
);

// ── Reason copy ─────────────────────────────────────────────────────────────
check(
  "reason names the boot time in UTC",
  runnerRestartReason(BOOT) ===
    "The builder restarted at 10:53 UTC and this run's agent session ended with it.",
);

for (const [name, ok] of cases) console.log(`${ok ? "✓" : "✗"} ${name}`);
console.log(`\n${pass}/${cases.length} passed`);
if (pass !== cases.length) process.exit(1);
