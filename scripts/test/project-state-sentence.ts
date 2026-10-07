// One sentence per project, ending on the outcome. The project page's Build
// strip used to end on "work reached the repo" — true, and not what the
// person who asked for the change wanted to know. Operator, 2026-10-07: "is
// solving the problem feeling like magic? if not, what is stopping it".
// Run: npx tsx scripts/test/project-state-sentence.ts
import { projectStateSentence, siteName } from "@/lib/project-state-sentence";
import type { BuildStatus, LastAttempt } from "@/lib/project-build-status";
import { FIX_SHIP_STATE } from "@/lib/feedback/fix-shipping";
import { MINUTE_MS } from "@/lib/constants/time";

let pass = 0;
let fail = 0;
function ok(cond: unknown, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

const NOW = Date.now();
const last = (over: Partial<LastAttempt>): LastAttempt => ({
  outcome: "success",
  startedAtMs: NOW - 30 * MINUTE_MS,
  finishedAtMs: NOW - 10 * MINUTE_MS,
  durationMinutes: 20,
  landed: true,
  shipping: null,
  error: null,
  ...over,
});
const idle = (l: LastAttempt | null): BuildStatus => ({ kind: "idle", last: l });

// Words, not identifiers. "#43", "PR", "CI", "auto-merge" are how the system
// gets there and never what it says.
const JARGON = /\b(PR|CI|auto-merge|#\d+|commit|repo)\b/;

{
  const s = projectStateSentence({ kind: "building", sinceMs: NOW - 9 * MINUTE_MS, label: null });
  ok(s.headline === "Building now" && s.tone === "working" && !s.waitingOnYou, "building");
}
{
  const s = projectStateSentence({ kind: "stalled", sinceMs: NOW - 40 * MINUTE_MS });
  ok(s.waitingOnYou && s.tone === "waiting", "a dispatch nobody picked up waits on you");
}
{
  const s = projectStateSentence(idle(null));
  ok(s.headline === "Nothing built yet" && s.waitingOnYou, "nothing built yet waits on you");
}
{
  const s = projectStateSentence(
    idle(last({ outcome: "partial", shipping: { state: FIX_SHIP_STATE.DEPLOYED, prNumber: 43 } })),
    { liveUrl: "https://www.skif.ch/" },
  );
  ok(s.headline === "Live at skif.ch", `deployed → live at the site (got "${s.headline}")`);
  ok(s.tone === "live" && !s.waitingOnYou, "live is the end state, nothing to do");
  ok(!JARGON.test(s.headline) && !JARGON.test(s.detail), "no jargon in the live sentence");
}
{
  const s = projectStateSentence(
    idle(last({ shipping: { state: FIX_SHIP_STATE.PR_OPEN, prNumber: 43, prUrl: "https://x" } })),
  );
  ok(!s.waitingOnYou, "a change in review goes live by itself — not waiting on you");
  ok(/goes live by itself/.test(s.headline), `says so (got "${s.headline}")`);
  ok(!JARGON.test(s.headline) && !JARGON.test(s.detail), "no jargon in the review sentence");
}
{
  const s = projectStateSentence(
    idle(last({ shipping: { state: FIX_SHIP_STATE.DEPLOY_FAILED, deployName: "Deploy" } })),
  );
  ok(s.waitingOnYou && /not live/.test(s.headline), "a failed deploy waits on you, says not live");
}
{
  const s = projectStateSentence(idle(last({ shipping: { state: FIX_SHIP_STATE.PR_CLOSED } })));
  ok(s.waitingOnYou && !/live/.test(s.detail.replace("going live", "")), "a dropped change waits");
}
{
  // The ledger outranks the run's own grade: a partial run that shipped is live.
  const s = projectStateSentence(
    idle(last({ outcome: "partial", landed: false, shipping: { state: FIX_SHIP_STATE.DEPLOYED } })),
  );
  ok(s.tone === "live", "ledger beats outcome");
}
{
  const s = projectStateSentence(idle(last({ outcome: "timeout", landed: false })));
  ok(
    /Stopped before it was done/.test(s.headline) && /nothing was saved/.test(s.detail),
    "timeout",
  );
  ok(!JARGON.test(s.detail), "no 'repo' in the failure sentence");
}
{
  const s = projectStateSentence(idle(last({ outcome: "success", landed: true })));
  ok(s.headline === "Done, not yet live" && s.waitingOnYou, "saved but unshipped waits on you");
}
ok(siteName("https://www.skif.ch/path") === "skif.ch", "site name drops www and path");
ok(siteName("not a url") === null && siteName(null) === null, "bad or missing url → null");

console.log(`${fail ? "✗" : "✓"} project-state-sentence: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
