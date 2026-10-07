import { isLateNight, lateNightCopy, nightKey } from "@/lib/late-night";

let failed = 0;
const check = (name: string, ok: boolean) => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
};
const at = (h: number, m = 0) => new Date(2026, 9, 7, h, m);

check("22:59 is not late", !isLateNight(at(22, 59)));
check("23:00 is late", isLateNight(at(23)));
check("02:30 is late", isLateNight(at(2, 30)));
check("05:00 is morning", !isLateNight(at(5)));
check(
  "one night from 23:10 to 01:30",
  nightKey(at(23, 10)) === "2026-10-07" && nightKey(new Date(2026, 9, 8, 1, 30)) === "2026-10-07",
);
check("the next evening is a new night", nightKey(new Date(2026, 9, 8, 23)) === "2026-10-08");
check("night key across a month edge", nightKey(new Date(2026, 10, 1, 1)) === "2026-10-31");
check("autopilot off offers the one tap", lateNightCopy("off").action === "Turn on autopilot");
check(
  "autopilot on just says sleep",
  lateNightCopy("on").action === null && /sleep/.test(lateNightCopy("on").headline),
);

if (failed) {
  console.error(`late-night: ${failed} failed`);
  process.exit(1);
}
console.log("late-night: all passed");
