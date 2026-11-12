/**
 * The chat start says what day it is and opens the day.
 *
 * 2026-11-12, the owner at 06:05: the first screen "could tell what time it
 * is and say what's today and let's start my day". /loki is the home after
 * sign-in (2026-11-01) and the day lives on Today (2026-10-21), so the start
 * carries a date line and ONE row into Today, named for the reader's hour —
 * not the card that was removed. Both read the reader's clock after mount:
 * the box runs UTC (hooks/use-local-now).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dayRowTitle, startDateLine } from "../../src/components/loki/StartScreen";

assert.equal(dayRowTitle(6), "Start my day");
assert.equal(dayRowTitle(11), "Start my day");
assert.equal(dayRowTitle(12), "My day");
assert.equal(dayRowTitle(16), "My day");
assert.equal(dayRowTitle(17), "Wrap up my day");
assert.equal(dayRowTitle(2), "Wrap up my day", "the small hours close the day before");
console.log("  ✓ the row into Today is named for the hour");

const line = startDateLine(new Date(2026, 10, 12, 7, 20));
assert.match(line, /Thursday/);
assert.match(line, /12/);
assert.match(line, /07:20|7:20/);
console.log("  ✓ the date line names the weekday, the date and the time");

const src = readFileSync("src/components/loki/StartScreen.tsx", "utf8");
assert.ok(src.includes("useLocalNow()"), "the clock is the reader's, read after mount");
assert.ok(!/new Date\(\)/.test(src), "no server clock in render: it hydrates as a mismatch");
assert.ok(src.includes("NAV.today.href"), "the row opens Today, the day's one home");
console.log("  ✓ reader's clock only; the row links Today");

console.log("loki start knows the day: all passed");
