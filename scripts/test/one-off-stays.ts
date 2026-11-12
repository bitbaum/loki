/**
 * A fresh one-off stays one-off: nothing of the project's shared session goes
 * into it, and nothing of it goes back into the shared session.
 *
 * Found by a review of the merged fresh-session change (2026-11-12): a retry
 * sent the one-off to the shared session; Control could close it with the
 * shared session's handoff; its prompt carried the project's escalation note
 * (and, on the local runtime, the shared session's notes); its close moved
 * the project's escalation ladder; the local runtime marked the shared tab as
 * working on it; and OrangeCat's separateSession fell back to the shared
 * queue when no lane was free.
 *
 * Run: npx tsx scripts/test/one-off-stays.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { ladderEffectForClose } from "@/lib/orchestration/escalation-ladder";

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
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const oneOff = { payload: { oneOff: true, sessionTab: "orangecat~9e3658d9" } };

check("a one-off's close neither advances nor clears the project's ladder", () => {
  for (const outcome of ["timeout", "error", "unconfirmed", "success", "partial"]) {
    assert(ladderEffectForClose(outcome, oneOff).kind === "ignore", `${outcome} moved the ladder`);
  }
});

check("the project's own runs still move it", () => {
  assert(ladderEffectForClose("timeout").kind === "advance", "a failure no longer advances");
  assert(ladderEffectForClose("success", { payload: {} }).kind === "resolve", "success");
  assert(
    ladderEffectForClose("timeout", { payload: { sessionTab: "orangecat~1a2b3c4d" } }).kind ===
      "advance",
    "an ordinary parallel run is the project's work and still counts",
  );
});

check("every close path hands the closed run to the ladder", () => {
  const src = read("src/db/queries/orchestration-runs.ts");
  assert(/ladderEffectForClose\(patch\.outcome, updated\)/.test(src), "the funnel");
  assert(/ladderEffectForClose\(closed\.outcome, closed\)/.test(src), "closeRunUndelivered");
  assert(/ladderEffectForClose\(r\.outcome, r\)/.test(src), "the reaper");
  assert(!/ladderEffectForClose\([a-z.]+\)/i.test(src), "a call without the run");
});

check("a one-off's prompt carries no escalation note and none of the shared session", () => {
  const remote = read("src/lib/inject-prompt.ts");
  assert(
    /oneOff \? Promise\.resolve\(""\) : getOpenEscalationBlock\(userId, projectKey\)/.test(remote),
    "the cloud prompt gets the escalation note",
  );
  const core = read("src/lib/inject-core.ts");
  assert(
    /oneOff \? Promise\.resolve\(""\) : getOpenEscalationBlock\(userId, canonical\)/.test(core),
    "the local prompt gets the escalation note",
  );
  assert(
    /oneOff \? base : enrichPrompt\(base, effectiveTab/.test(core),
    "the local prompt gets the shared session's handoff and file",
  );
  assert(
    (core.match(/oneOff: params\.session === "fresh",/g) ?? []).length === 2,
    "both prompt builders must be told",
  );
});

check("the local runtime leaves the shared tab's files alone for a one-off", () => {
  assert(
    /if \(runtimeAvailable && params\.session !== "fresh"\) \{\s*await writeLocalInjectSideEffects/.test(
      read("src/lib/inject-core.ts"),
    ),
    "the shared tab is marked as working on the one-off",
  );
});

check("a one-off is retried as a one-off", () => {
  assert(
    /run\.payload\?\.oneOff === true \? \{ session: "fresh" as const \} : \{\}/.test(
      read("src/lib/project-retry.ts"),
    ),
    "the retry goes to the shared session",
  );
});

check("Control never closes a lane run from the shared session's handoff", () => {
  const src = read("src/app/api/control/route.ts");
  const fn = src.slice(src.indexOf("function maybeCloseRunFromHandoff"));
  const guard = fn.indexOf("sessionTab?: unknown");
  const close = fn.indexOf("closeRunFromSession?.(latestRun, session)");
  assert(guard > 0 && guard < close, "the shared handoff is applied to a lane run");
});

check("OrangeCat's separate session is a fresh session, never the shared queue", () => {
  const route = read("src/app/api/orangecat/task/route.ts");
  assert(
    /const session = separateSession \? "fresh" : dataOrResp\.session;/.test(route),
    "not fresh",
  );
  assert(/\.\.\.\(session \? \{ session \} : \{\}\),/.test(route), "the session is not passed on");
  assert(!/whenBusy: "lane"/.test(route), "still a lane that can fall back");
  assert(
    /\.\.\.\(input\.session \? \{ session: input\.session \} : \{\}\),/.test(
      read("src/lib/multi-project-dispatch.ts"),
    ),
    "the option does not reach inject",
  );
});

if (failures) {
  console.log(`\none-off-stays: ${failures} failed`);
  process.exit(1);
}
console.log("\none-off-stays: all passed");
