/**
 * The public "agents running" number must mean agents that are running.
 *
 * Measured on prod, 2026-09-20. `/investors` read:
 *
 *   40 projects · 46 agents running · 115 runs this week
 *
 * directly under the sentence "the homepage hero and this page render the same
 * live snapshot of that fleet — real data, never fabricated numbers."
 *
 * The numbers were not fabricated. They were STALE, which on an investor page
 * is worse, because it is offered as proof of activity:
 *
 *   flagged agent_running = true ............ 46
 *   updated in the last 30 minutes ..........  2
 *   oldest flagged row last touched ......... 2026-08-13, 910 hours earlier
 *
 * `project_states.agent_running` is a raw boolean that nothing expires — a
 * session killed mid-run never clears it. Control does not have this problem
 * because it bounds the same question by OPEN_TURN_TTL_MS (30 minutes), a
 * constant that exists because without it "a dead Codex tab showed working
 * 61h". The public query simply never applied it, so the same database said
 * "46 running" to a stranger and "0 working" to the operator.
 *
 * This pins the SHAPE of the fix: the public count is time-bounded, by the
 * shared constant rather than a second number of its own.
 *
 * Run: npx tsx scripts/test/public-running-is-fresh.ts
 */
import { readFileSync } from "node:fs";
import { OPEN_TURN_TTL_MS } from "@/lib/agent-turns";

const SRC = new URL("../../src/db/queries/public-fleet.ts", import.meta.url).pathname;

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const src = readFileSync(SRC, "utf8");

console.log("public-running-is-fresh:");

check("the bound is the SHARED constant, not a second number", () => {
  // Two definitions of "too old to believe" eventually disagree on screen, and
  // then a reader is right to trust neither.
  assert(src.includes("OPEN_TURN_TTL_MS"), "public-fleet must use OPEN_TURN_TTL_MS");
  assert(
    !/agent_running[\s\S]{0,200}?\b(?:15|20|45|60)\s*\*\s*60\s*\*\s*1000/.test(src),
    "a hand-rolled TTL appeared beside the running check",
  );
});

check("no unbounded agentRunning check survives", () => {
  // THE BUG, pinned. `eq(projectStates.agentRunning, true)` on its own is the
  // exact expression that published a 38-day-old flag as live.
  const bare = [
    ...src.matchAll(/where\(\s*eq\(\s*projectStates\.agentRunning\s*,\s*true\s*\)\s*\)/g),
  ];
  assert(
    bare.length === 0,
    `${bare.length} unbounded running check(s) — every one must go through the freshness bound`,
  );
});

check("both the count and the per-project dots use the same rule", () => {
  // The hero paints a running/idle dot per project from a SECOND query. If only
  // the headline number were bounded, the dots would still light up for a
  // project whose agent died in August.
  const uses = [...src.matchAll(/isActuallyRunning\(/g)];
  assert(uses.length >= 3, `expected the predicate defined and used twice, saw ${uses.length}`);
});

check("the window is half an hour, as Control uses", () => {
  assert(OPEN_TURN_TTL_MS === 30 * 60 * 1000, `TTL changed: ${OPEN_TURN_TTL_MS}ms`);
});

check("isLive rides the same bound", () => {
  // `isLive: totals.running > 0` drives the hero's LIVE flag. It was true for
  // weeks on the strength of flags nobody had cleared.
  assert(/isLive:\s*totals\.running\s*>\s*0/.test(src), "isLive still derives from totals.running");
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
