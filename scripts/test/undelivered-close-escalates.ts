/**
 * A dispatch that dies before reaching an agent must still advance the
 * project's escalation ladder.
 *
 * Regression: 2026-09-21. `closeRunUndelivered` stamped `error`, emitted a run
 * event, and called `notifyRunClosed` — but never `advanceEscalation`. It was
 * the ONLY failing-close path feeding the ladder nothing: the funnel
 * (`updateOrchestrationRun`) advances, the reaper advances, this did not. So a
 * dispatch failing before an agent ever saw it could not build a streak no
 * matter how often it repeated, and the `human` rung — the thing that raises
 * the alert — was unreachable from this path.
 *
 * Notification did not cover the gap, and could not: `formatRunCloseMessage`
 * self-gates on `payload.notifyOnClose`, which ONLY human-initiated dispatches
 * carry ("autopilot churn stays quiet"). For an autopilot or cron dispatch the
 * notify call returns null, so the close said nothing to anybody.
 *
 * What that cost, measured on prod the day it was found: six dispatches failed
 * across FOUR projects (loki, kivvi, solon, reparaturbonus-zh) within twelve
 * hours on an exhausted Claude quota — every one through this path — while the
 * newest row in `alerts` was six days old. The fleet stopped executing and
 * nothing said so.
 *
 * Run: npx tsx scripts/test/undelivered-close-escalates.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ladderEffectForClose } from "../../src/lib/orchestration/escalation-ladder";

const root = join(import.meta.dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

console.log("an undelivered dispatch escalates");

// --- the predicate the fix derives from ----------------------------------
ok("an `error` close advances the ladder", ladderEffectForClose("error").kind === "advance");
ok("a `success` close still resolves it", ladderEffectForClose("success").kind === "resolve");
ok(
  "a user abort is still ignored (it earns no streak)",
  ladderEffectForClose("user_abort").kind === "ignore",
);

// --- the wiring, which IS the bug ----------------------------------------
// The defect was never a wrong value; it was a call that did not exist. So
// assert against the function body, not merely the file.
const runsFile = read("src/db/queries/orchestration-runs.ts");
const start = runsFile.indexOf("export async function closeRunUndelivered");
ok("closeRunUndelivered exists", start !== -1);
const rest = runsFile.slice(start + 1);
const nextExport = rest.indexOf("\nexport ");
const body = nextExport === -1 ? rest : rest.slice(0, nextExport);

ok("closeRunUndelivered advances the escalation ladder", body.includes("advanceEscalation"));
ok("…gated by the shared predicate, not an assumption", body.includes("ladderEffectForClose"));
ok("…and still notifies, which the ladder does not replace", body.includes("notifyRunClosed"));

// --- why the notification alone was never enough --------------------------
// Pin the gate that made this silent, so nobody later "simplifies" the ladder
// call away believing notifyRunClosed already covers automation.
const notifyFormat = read("src/lib/orchestration/notify-close-format.ts");
ok(
  "run-close notification self-gates on payload.notifyOnClose",
  /notifyOnClose/.test(notifyFormat) && /return null/.test(notifyFormat),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
