/**
 * "N needs you" has ONE derivation.
 *
 * Measured on production 2026-09-22, on a single 1512px screen: the sidebar
 * badged Feedback **4** and /today's front-door verdict said "**5** feedback
 * reports to triage". Four inches apart, one payload, two numbers — the exact
 * defect the verdict had just been built to end, reappearing one component to
 * the left of it.
 *
 * Four derivations existed, in three spellings:
 *   use-control-inbox    Σ (s.newCount || s.openCount)
 *   NotificationsPill    Σ (s.newCount || s.openCount)           (hand copy)
 *   ControlInbox         s.newCount > 0 ? s.newCount : s.openCount
 *   FeedbackNavCount     Σ s.newCount
 *
 * TWO RULES, both about honesty rather than tidiness:
 *
 *   1. ONE OWNER. `lib/feedback/queue-counts` is the only place the count is
 *      computed. A second reduce is how two numbers happen; it does not matter
 *      that all four were written by someone being careful.
 *   2. DISPATCHED IS NOT WAITING ON YOU. `newCount || openCount` is backwards:
 *      1 new + 4 dispatched contributes 1, but 0 new + 4 dispatched
 *      contributes 4, so progress INFLATES a number captioned "to triage".
 *
 * Run: npx tsx scripts/test/one-number-for-feedback.ts
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import {
  feedbackAwaitingTriage,
  feedbackInProgress,
  feedbackProjectsInPlay,
} from "../../src/lib/feedback/queue-counts";

const ROOT = process.cwd();
const OWNER = "src/lib/feedback/queue-counts.ts";
/** The producer. It may name the columns — it computes them. */
const PRODUCER = "src/db/queries/site-feedback.ts";

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

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}
/** Comments are stripped before scanning — the files that EXPLAIN the banned
 *  formula are the ones that quote it, and a gate that fails on its own
 *  documentation teaches you to delete the documentation. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const files = walk(join(ROOT, "src")).map((p) => ({
  rel: relative(ROOT, p),
  src: strip(readFileSync(p, "utf8")),
}));

console.log("one-number-for-feedback:");

check("THE BUG: the backwards fallback exists nowhere", () => {
  // `newCount || openCount` and `newCount > 0 ? newCount : openCount` are the
  // same wrong rule in two spellings. Ban the RULE, both ways of writing it —
  // and everywhere, the owner included, because it is not right there either.
  const offenders = files.filter(
    (f) =>
      /newCount\s*\|\|\s*[\w.]*openCount/.test(f.src) ||
      /newCount\s*>\s*0\s*\?[^:]*:\s*[\w.]*openCount/.test(f.src),
  );
  assert(
    offenders.length === 0,
    `dispatched work counted as awaiting triage in: ${offenders.map((o) => o.rel).join(", ")}`,
  );
});

check("RULE 1: nothing outside the owner reduces the counts itself", () => {
  const offenders = files.filter(
    (f) =>
      f.rel !== OWNER &&
      f.rel !== PRODUCER &&
      /reduce\s*\([^)]*\)?[\s\S]{0,120}?\b(newCount|openCount)\b/.test(f.src),
  );
  assert(
    offenders.length === 0,
    `a second derivation of the feedback count lives in: ${offenders.map((o) => o.rel).join(", ")} — import it from ${OWNER}`,
  );
});

check("and every surface that shows a count reads the owner", () => {
  for (const rel of [
    "src/hooks/use-control-inbox.ts",
    "src/components/shell/NotificationsPill.tsx",
    "src/components/feedback/FeedbackNavCount.tsx",
  ]) {
    const f = files.find((x) => x.rel === rel);
    assert(Boolean(f), `${rel} is gone — re-point this gate at whatever replaced it`);
    assert(f!.src.includes("feedbackAwaitingTriage"), `${rel} does not read the shared count`);
  }
});

check("nothing re-declares the summary SHAPE either", () => {
  // NotificationPanel carried a structural copy of ProjectFeedbackSummary.
  // A second declaration does not break at runtime, which is why it survives:
  // it just quietly stops seeing any field the real type gains.
  const offenders = files.filter(
    (f) =>
      f.rel !== PRODUCER &&
      /type\s+\w*FeedbackSummary\s*=\s*\{[\s\S]{0,200}?\bnewCount\b[\s\S]{0,120}?\bopenCount\b/.test(
        f.src,
      ),
  );
  assert(
    offenders.length === 0,
    `a second declaration of the feedback summary shape lives in: ${offenders.map((o) => o.rel).join(", ")} — import it from ${PRODUCER}`,
  );
});

check("RULE 2: a project whose reports are all dispatched needs nothing", () => {
  const s = [
    { projectId: "a", projectName: "A", newCount: 0, openCount: 4, latestAt: "" },
    { projectId: "b", projectName: "B", newCount: 1, openCount: 5, latestAt: "" },
  ];
  assert(
    feedbackAwaitingTriage(s) === 1,
    `awaiting triage should be 1 (only B's new row), got ${feedbackAwaitingTriage(s)}`,
  );
  // The old formula scored this 4 + 1 = 5. Progress must not raise the number.
  const triaged = [{ ...s[1], newCount: 0 }];
  assert(
    feedbackAwaitingTriage(triaged) < feedbackAwaitingTriage([s[1]]),
    "triaging a report did not LOWER the count of things awaiting triage",
  );
});

check("but it stays LISTED — presence and pressure are different questions", () => {
  // The chip must not vanish mid-watch while the fix it dispatched is running.
  // That is what the fallback was supposed to protect and never did: the query
  // filters to NEW+DISPATCHED, so presence was always safe on its own.
  const s = [{ projectId: "a", projectName: "A", newCount: 0, openCount: 4, latestAt: "" }];
  assert(feedbackProjectsInPlay(s).length === 1, "a dispatched-only project fell out of the list");
  assert(feedbackInProgress(s) === 4, `in-progress should be 4, got ${feedbackInProgress(s)}`);
});

check("the producer still guarantees presence, so the list needs no fallback", () => {
  const src = files.find((f) => f.rel === PRODUCER)!.src;
  assert(
    /inArray\(\s*siteFeedback\.status,\s*\[\s*FEEDBACK_STATUS\.NEW,\s*FEEDBACK_STATUS\.DISPATCHED/.test(
      src,
    ),
    "listFeedbackSummary no longer filters to new+dispatched — a dispatched-only project may now be absent, and the reason the count needs no fallback is gone",
  );
});

check("the feedback group is gated on PRESENCE, not on the count", () => {
  // Gating the group on `feedbackCount > 0` is how removing the fallback would
  // silently re-create the bug it was reaching for: the last NEW report gets
  // dispatched, the count drops to zero, and the project chip disappears from
  // under the operator watching its fix run.
  const inbox = files.find((f) => f.rel === "src/components/control/ControlInbox.tsx")!.src;
  assert(
    !/\{\s*feedbackCount\s*>\s*0\s*&&\s*\(?\s*<GroupRow/.test(inbox),
    "the feedback group renders only when the count is non-zero — a fully-dispatched project vanishes mid-watch",
  );
  assert(
    /\{\s*summary\.length\s*>\s*0\s*&&/.test(inbox),
    "the feedback group is not gated on whether any project is in play",
  );
});

check("a chip with nothing new says so in words, not in a number", () => {
  const inbox = files.find((f) => f.rel === "src/components/control/ControlInbox.tsx")!.src;
  assert(
    /in progress/i.test(inbox),
    "a fully-dispatched project still renders a bare count, which reads as work you owe",
  );
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
