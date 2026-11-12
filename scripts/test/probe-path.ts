/**
 * The probe path: a read-only request sent through POST /api/inject or the MCP
 * loki_dispatch, asking for the cloud builder, ends Done and creates no
 * Needs you.
 *
 * Found by a review of the path end to end (2026-11-12):
 * - every run's status went through the feedback-fix mapper, which calls a
 *   run that finished well with no pull request "Needs you, nothing shipped";
 * - neither entry point could ask for the cloud builder (zod drops unknown
 *   keys, so `builderChannel` vanished without a word);
 * - a fresh session refused for lack of a free lane counted as a failing run
 *   and could page the owner after four.
 *
 * Run: npx tsx scripts/test/probe-path.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { CANONICAL_CAUSE, CANONICAL_STATE, canonicalStatus } from "@/lib/feedback/canonical-status";
import { FEEDBACK_WORK_PHASE, WAITING_ON, type FeedbackWorkView } from "@/lib/feedback/work-phase";
import { FIX_SHIP_STATE } from "@/lib/feedback/fix-shipping";

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

/** A run that closed well, and the ledger found nothing on GitHub. */
const finishedNothingPushed: FeedbackWorkView = {
  phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY,
  waitingOn: WAITING_ON.YOU,
  label: "x",
  detail: null,
  ship: { state: FIX_SHIP_STATE.NO_EVIDENCE, checkedAt: "2026-11-12T05:00:00Z" },
};

check("the incident: a git status probe that finished well is Done, not Needs you", () => {
  const got = canonicalStatus(finishedNothingPushed, { expectsChange: false });
  assert(got.state === CANONICAL_STATE.DONE, `state ${got.state}`);
  assert(got.cause === CANONICAL_CAUSE.FINISHED_NO_CHANGE, `cause ${got.cause}`);
  assert(got.nextAction.who === WAITING_ON.NOBODY, `who ${got.nextAction.who}`);
  assert(got.reason === null, "a Done carries a problem sentence");
});

check("a feedback fix with nothing shipped still needs you, as before", () => {
  for (const opts of [{}, { expectsChange: true }]) {
    const got = canonicalStatus(finishedNothingPushed, opts);
    assert(got.state === CANONICAL_STATE.NEEDS_YOU, `state ${got.state}`);
    assert(got.cause === CANONICAL_CAUSE.NOTHING_SHIPPED, `cause ${got.cause}`);
  }
});

check(
  "a run that is not a fix but pushed a branch without a pull request is still followed",
  () => {
    const got = canonicalStatus(
      { ...finishedNothingPushed, ship: { state: FIX_SHIP_STATE.PUSHED, checkedAt: "x" } },
      { expectsChange: false },
    );
    assert(got.state === CANONICAL_STATE.NEEDS_YOU, "a pushed branch with no PR was hidden");
  },
);

check("the run's status loader asks whether the run is a feedback fix", () => {
  const src = read("src/lib/run-track-load.ts");
  assert(/expectsChange: Boolean\(feedbackFix\),/.test(src), "not passed");
  assert(
    /getFeedbackByRunId\(userId, run\.id\)\.then\(\s*\(row\) => row !== null,\s*\(\) => true,/.test(
      src,
    ),
    "a failed lookup must keep the old rule",
  );
});

check("POST /api/inject can ask for the cloud builder", () => {
  const src = read("src/app/api/inject/route.ts");
  assert(/builderChannel: z\.enum\(BUILDER_CHANNELS\)\.optional\(\),/.test(src), "schema");
  assert(/\.\.\.\(builderChannel \? \{ builderChannel \} : \{\}\),/.test(src), "not passed on");
});

check("MCP loki_dispatch can ask for the cloud builder", () => {
  const tools = read("src/lib/mcp/tools.ts");
  assert(/builder: z\s*\.enum\(\["cloud", "local"\]\)/.test(tools), "schema");
  assert(
    /args\.builder \? \{ builderChannel: args\.builder \} : \{\}/.test(tools),
    "not passed on",
  );
  assert(
    /opts\?\.builderChannel \? \{ builderChannel: opts\.builderChannel \} : \{\}/.test(
      read("src/lib/mcp/services.ts"),
    ),
    "the service drops it",
  );
});

check("a fresh session refused for lack of a lane is not a failing run", () => {
  const core = read("src/lib/inject-core.ts");
  assert(
    /ladder: \(result as \{ code\?: string \}\)\.code !== "fresh-session-unavailable",/.test(core),
    "inject",
  );
  const q = read("src/db/queries/orchestration-runs.ts");
  assert(
    /opts\.ladder !== false &&\s*ladderEffectForClose\(closed\.outcome(, closed)?\)/.test(q),
    "close",
  );
});

if (failures) {
  console.log(`\nprobe-path: ${failures} failed`);
  process.exit(1);
}
console.log("\nprobe-path: all passed");
