/**
 * Three numbers on the Feedback page that did not reconcile.
 *
 * Prod, 2026-09-20 — the header cards read:
 *
 *   REPORTS 68            SHIPPED 32              REPORT → CONFIRMED 6d
 *   29 still open         18 in the last 30 days  median
 *
 * 29 + 32 is 61. The other seven were `archived` — filed away rather than
 * fixed — and no card admitted that state existed, so a reader who checks the
 * arithmetic concludes one of the numbers is wrong. Each number was correct;
 * the page just never named the remainder.
 *
 * Confirmed against the database: resolved 32 · dispatched 25 · archived 7 ·
 * new 4 = 68, where "open" is new + dispatched.
 *
 * Run: npx tsx scripts/test/feedback-numbers-add-up.ts
 */
import { reportsSubLine } from "@/components/feedback/FeedbackInbox";

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

console.log("feedback-numbers-add-up:");

check("the exact prod shape names every report", () => {
  // THE BUG, pinned. 68 = 29 open + 32 shipped + 7 archived.
  const m = { total: 68, open: 29, resolved: 32, archived: 7 };
  const sub = reportsSubLine(m);
  assert(sub.includes("29 still open"), `open missing: ${sub}`);
  assert(sub.includes("7 archived"), `archived missing: ${sub}`);
  // The reader can now reconcile the headline from what is on screen.
  assert(m.open + m.resolved + m.archived === m.total, "fixture must itself add up");
});

check("nothing archived says nothing about archiving", () => {
  // The common case must not grow a "0 archived" that means nothing.
  const sub = reportsSubLine({ total: 40, open: 8, resolved: 32, archived: 0 });
  assert(sub === "8 still open", `got: ${sub}`);
});

check("everything handled still reads as handled", () => {
  assert(
    reportsSubLine({ total: 32, open: 0, resolved: 32, archived: 0 }) === "all handled",
    "all handled",
  );
});

check("archived-only is stated rather than swallowed", () => {
  // A queue whose remainder is entirely archived must still explain itself,
  // or the total looks like a lie on its own.
  const sub = reportsSubLine({ total: 39, open: 0, resolved: 32, archived: 7 });
  assert(sub === "7 archived", `got: ${sub}`);
});

check("both parts are separated, not concatenated", () => {
  const sub = reportsSubLine({ total: 68, open: 29, resolved: 32, archived: 7 });
  assert(sub.includes("·"), `expected a separator: ${sub}`);
  assert(!/open\d/.test(sub), "numbers must not run together");
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
