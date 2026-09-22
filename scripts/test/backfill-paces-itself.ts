/**
 * The backfill janitor must not spend its budget being refused.
 *
 * OrangeCat allows 30 writes per minute per user (`rateLimitWriteAsync`,
 * sliding 60s window). This janitor fired its whole tick as fast as the event
 * loop allowed, so measured on prod 2026-09-22 — the first tick after a
 * five-day publishing outage — it reported `posted: 30, failed: 20`. The first
 * thirty landed, the bucket emptied, and every remaining attempt came back 429
 * and was counted as a failure.
 *
 * That is not a flake to retry past. Any backlog larger than thirty burned the
 * remainder of its budget on refusals, every tick, forever — and because the
 * external ids are deterministic, the next day re-sent the same doomed twenty.
 *
 * Run: npx tsx scripts/test/backfill-paces-itself.ts
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = readFileSync(
  join(ROOT, "src/app/api/crons/orangecat-promote-backfill/route.ts"),
  "utf8",
);

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

const paceMatch = /const PROMOTE_PACE_MS = ([\d_]+);/.exec(SRC);
const pace = paceMatch ? Number(paceMatch[1].replace(/_/g, "")) : 0;

ok(pace > 0, "the janitor declares a pace");
ok(
  pace >= 2_000,
  `the pace is at or under the neighbour's 30-per-minute limit (60000/30 = 2000ms); found ${pace}ms`,
);
ok(
  /if \(attempted > 0\) await sleep\(PROMOTE_PACE_MS\);/.test(SRC),
  "...and waits between emits, but not before the first one",
);

const budgetMatch = /const TIME_BUDGET_MS = ([\d_]+);/.exec(SRC);
const budget = budgetMatch ? Number(budgetMatch[1].replace(/_/g, "")) : 0;
ok(budget > 0, "the tick has a time budget");
ok(
  budget < 120_000,
  `it ends before the caller's 120s curl timeout, or the tick dies with no account of itself; found ${budget}ms`,
);
ok(
  /Date\.now\(\) - startedAt > TIME_BUDGET_MS/.test(SRC) && /capped = true/.test(SRC),
  "...and reports `capped` when it stops early, rather than looking complete",
);

// The pace only means something if a full tick still fits inside the budget —
// otherwise the cap is decorative and the real limit is the clock.
const capMatch = /const MAX_PROMOTES_PER_TICK = (\d+);/.exec(SRC);
const cap = capMatch ? Number(capMatch[1]) : 0;
ok(cap > 0, "the per-tick cap is still declared");
ok(
  cap * pace > budget,
  "the clock, not the cap, is what ends a large tick — which is why `capped` must be honest",
);

console.log(`${pass}/${pass + fail} backfill-paces-itself cases passed`);
if (fail > 0) process.exit(1);
