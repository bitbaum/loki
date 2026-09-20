/**
 * The operator goals & deadlines block that prefixes every dispatch.
 *
 * These checks lived inside the source file as an inline `--self-test`, which
 * nothing invoked: scripts/test-unit.ts globs THIS directory, so a check that
 * sits anywhere else is coverage nobody runs. Moved here, where it does.
 *
 * The dates half exists because of #584: dispatches on 2026-09-20 announced
 * "near-term commitments/deadlines" and then listed a bonus window that closed
 * 2026-05-03 and a restore window that closed 2026-07-03 — the two OLDEST rows
 * in the table, which had taken the whole cap because "soonest first" sorts
 * ascending and overdue rows are deliberately in scope. Nothing threw; the
 * prompt read as ordinary prose and told the agent to prioritise by it.
 *
 * Run: npx tsx scripts/test/operator-context-format.ts
 */
import {
  formatOperatorContextBlock,
  OPERATOR_CONTEXT_HEADING,
} from "@/lib/dispatch-operator-context-format";
import { isOverdue, toLocalDateStr } from "@/lib/dates";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? `\n    ${detail}` : ""}`);
  }
}

// A fixed "today" so every case below is a statement about the data, not about
// the day the suite happens to run.
const NOW = new Date("2026-09-20T12:00:00Z");
const PAST = new Date("2026-05-03T00:00:00Z");
const FUTURE = new Date("2026-09-30T00:00:00Z");
const TODAY = new Date("2026-09-20T23:00:00Z");

// ── layout ───────────────────────────────────────────────────────────────────
check("empty in ⇒ empty string", formatOperatorContextBlock([], [], NOW) === "");

const goalsOnly = formatOperatorContextBlock(
  [{ title: "Ship paid tier", progress: 40, targetDate: FUTURE }],
  [],
  NOW,
);
check("goals header present", goalsOnly.includes("top-level goals"));
check("goal progress rendered", goalsOnly.includes("(40%)"));
check("goal target date rendered", goalsOnly.includes(`target ${toLocalDateStr(FUTURE)}`));
check("no commitments header when none", !goalsOnly.includes("commitments/deadlines"));

const commitsOnly = formatOperatorContextBlock(
  [],
  [{ description: "Investor demo", dueDate: FUTURE }],
  NOW,
);
check("commitments header present", commitsOnly.includes("commitments/deadlines"));
check("commitment due rendered", commitsOnly.includes(`due ${toLocalDateStr(FUTURE)}`));

const nulls = formatOperatorContextBlock(
  [{ title: "G", progress: null, targetDate: null }],
  [{ description: "C", dueDate: null }],
  NOW,
);
check("no progress % when null", !nulls.split("\n")[1].includes("%"));
check("no target when null goal date", !nulls.split("\n")[1].includes("target"));
check("blank line separates the two sections", nulls.includes("\n\n"));

// ── dates tell the truth (#584) ──────────────────────────────────────────────
const overdue = formatOperatorContextBlock(
  [],
  [{ description: "Coinbase card bonus", dueDate: PAST }],
  NOW,
);
check("a past due date is marked OVERDUE", overdue.includes("(OVERDUE)"), overdue);
check("a past due date does not read as upcoming", !/ — due /.test(overdue), overdue);
check(
  "the overdue row keeps its date",
  overdue.includes(`was due ${toLocalDateStr(PAST)}`),
  overdue,
);

const upcoming = formatOperatorContextBlock(
  [],
  [{ description: "Investor demo", dueDate: FUTURE }],
  NOW,
);
check("a future due date is NOT marked overdue", !upcoming.includes("OVERDUE"), upcoming);

// Day granularity: something still due later today has not been missed.
const dueToday = formatOperatorContextBlock(
  [],
  [{ description: "Call the bank", dueDate: TODAY }],
  NOW,
);
check("due later today is not overdue", !dueToday.includes("OVERDUE"), dueToday);

const pastGoal = formatOperatorContextBlock(
  [{ title: "Reduce Monthly Burn", progress: 40, targetDate: PAST }],
  [],
  NOW,
);
check("a missed goal target says so", pastGoal.includes("(PAST, not met)"), pastGoal);

const futureGoal = formatOperatorContextBlock(
  [{ title: "Ship paid tier", progress: 40, targetDate: FUTURE }],
  [],
  NOW,
);
check("a live goal target is left alone", !futureGoal.includes("PAST"), futureGoal);

// The heading is what the strip patterns in lib/activity-status.ts anchor on.
check(
  "heading still frames the block as background",
  OPERATOR_CONTEXT_HEADING.startsWith("## ") && OPERATOR_CONTEXT_HEADING.includes("background"),
);

// A row the operator never has to guess about: no bare date without a word.
const both = formatOperatorContextBlock(
  [{ title: "G", progress: null, targetDate: PAST }],
  [
    { description: "old", dueDate: PAST },
    { description: "new", dueDate: FUTURE },
  ],
  NOW,
);
for (const line of both
  .split("\n")
  .filter((l) => l.startsWith("- ") && /\d{4}-\d{2}-\d{2}/.test(l))) {
  check(
    `dated row states whether it has passed: ${line.slice(0, 48)}`,
    /OVERDUE|PAST, not met|— due /.test(line),
    line,
  );
}

// ── the predicate itself ─────────────────────────────────────────────────────
// Day boundaries, because that is the only place this can be wrong: a due date
// is obviously past or obviously ahead everywhere else.
// Built from LOCAL calendar parts, not UTC instants: the predicate answers a
// question about calendar days, so a case written as "2026-09-19T23:59:59Z" is
// asking about a different day in half the world's timezones (it is already
// the 20th in Zurich) and would fail for being right.
const localDay = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);
const TODAY_NOON = localDay(2026, 9, 20);
check("yesterday is overdue", isOverdue(localDay(2026, 9, 19, 23), TODAY_NOON));
check("today at midnight is NOT overdue", !isOverdue(localDay(2026, 9, 20, 0), TODAY_NOON));
check("today at 23:59 is NOT overdue", !isOverdue(localDay(2026, 9, 20, 23), TODAY_NOON));
check("tomorrow is NOT overdue", !isOverdue(localDay(2026, 9, 21, 0), TODAY_NOON));
check("no date is not overdue", !isOverdue(null, NOW) && !isOverdue(undefined, NOW));
check("an unparseable date is not overdue", !isOverdue("not a date", NOW));
check("accepts an ISO string", isOverdue("2026-05-03T00:00:00Z", NOW));
// The invariant the whole fix rests on: the word never contradicts the date
// printed beside it.
check(
  "overdue ⇔ the printed date is before today's printed date",
  isOverdue(PAST, NOW) === toLocalDateStr(PAST) < toLocalDateStr(NOW) &&
    isOverdue(FUTURE, NOW) === toLocalDateStr(FUTURE) < toLocalDateStr(NOW),
);

console.log(failures === 0 ? "\n✓ operator context format" : `\n✗ ${failures} failed`);
process.exit(failures ? 1 : 0);
