// A swipe over the terminal must scroll it: xterm 6 only listens to the
// wheel, so on a phone the output could be watched but never read back
// (2026-10-05). These pin the arithmetic in src/lib/terminal-touch-scroll.ts.
// Run: npx tsx scripts/test/terminal-touch-scroll.ts
import {
  TOUCH_SCROLL_MIN_VELOCITY,
  decayVelocity,
  linesForDrag,
} from "@/lib/terminal-touch-scroll";

let pass = 0;
let fail = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else {
    fail++;
    console.error(`✗ ${label}: expected ${e}, got ${a}`);
  }
}

// Content follows the finger: dragging UP reveals newer output (scroll down).
eq(linesForDrag(-40, 0, 20), { lines: 2, carryPx: 0 }, "finger up 2 rows scrolls down 2");
eq(linesForDrag(40, 0, 20), { lines: -2, carryPx: 0 }, "finger down 2 rows scrolls up 2");

// A slow drag is as exact as a fast one: sub-row movement is carried, not lost.
let carry = 0;
let total = 0;
for (let i = 0; i < 10; i++) {
  const step = linesForDrag(6, carry, 20);
  carry = step.carryPx;
  total += step.lines;
}
eq(total, -3, "ten 6px moves over 20px rows add up to three rows");
eq(Math.round(carry), -0, "nothing left over that a row would have used");

// No layout yet (cell height 0) must not divide by zero or scroll anywhere.
eq(linesForDrag(-100, 5, 0), { lines: 0, carryPx: 0 }, "no cell height, no scroll");

// The glide slows and then stops — it never runs forever.
let v = 2;
let frames = 0;
while (v !== 0 && frames < 1000) {
  v = decayVelocity(v, 1000 / 60);
  frames++;
}
eq(v, 0, "a flick comes to rest");
eq(frames < 200, true, `and within a few seconds (${frames} frames)`);
eq(decayVelocity(TOUCH_SCROLL_MIN_VELOCITY / 2, 16), 0, "too slow to see is stopped");
// A dropped frame decays as much as the frames it stands in for.
eq(
  Math.abs(decayVelocity(1, 1000 / 30) - decayVelocity(decayVelocity(1, 1000 / 60), 1000 / 60)) <
    1e-9,
  true,
  "frame-rate independent",
);

console.log(`terminal-touch-scroll: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
