/**
 * Correcting a reaped run's outcome is a correction, not a second close.
 *
 * The reaper closes a stale run as `timeout` and emits "closed"; moments later
 * reap-evidence finds a PR the run had pushed and upgrades it to `partial`. It
 * emitted a SECOND "closed", so the run's history read "closed, closed" and
 * looked like two runs ending (Skif, 2026-09-25, twice).
 *
 * Run: npx tsx scripts/test/reap-correction-is-not-a-close.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RUN_EVENT_KINDS } from "@/db/schema/run-events";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(
  (RUN_EVENT_KINDS as readonly string[]).includes("reclassified"),
  "run_events needs a kind for an outcome corrected after close",
);

const src = readFileSync(join(__dirname, "../../src/lib/orchestration/reap-evidence.ts"), "utf8");
const emits = [...src.matchAll(/emitRunEvent\([^,]+,[^,]+,\s*"([a-z]+)"/g)].map((m) => m[1]);
assert(emits.length > 0, "reap-evidence emits its correction as a run event");
assert(
  !emits.includes("closed"),
  `reap-evidence emits "closed" — the reaper already closed the run; a correction must not close it again (got ${JSON.stringify(emits)})`,
);
assert(emits.includes("reclassified"), "reap-evidence records its correction as reclassified");

console.log("✓ a reap correction is not a second close");
