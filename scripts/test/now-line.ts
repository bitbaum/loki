/**
 * Loki knows what day it is, where the person is. Case from the live site
 * (2026-10-15): "dentist on Monday at 9am" → "the date for Monday is not in
 * your data".
 */
import { effectiveTimeZone, nowLine } from "@/lib/agent/now-line";

let passed = 0;
function check(label: string, cond: boolean): void {
  if (!cond) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}
const now = new Date("2026-10-15T22:30:00Z");

const zurich = nowLine(now, "Europe/Zurich");
check(
  "names the weekday and date in the person's zone",
  zurich.includes("Friday, 16 October 2026"),
);
check("…and the local time", zurich.includes("00:30"));
check("…and the zone", zurich.includes("(Europe/Zurich)"));
check("tells Loki to work dates out itself", /never ask the operator for a date/.test(zurich));
check(
  "an unusable zone falls back, never throws",
  nowLine(now, "Mars/Olympus").includes("Europe/Zurich"),
);

check("no preferences → the default zone", effectiveTimeZone(null, now) === "Europe/Zurich");
check(
  "home zone",
  effectiveTimeZone({ homeTimezone: "America/New_York" }, now) === "America/New_York",
);
check(
  "travelling, until a later day → the travel zone",
  effectiveTimeZone(
    {
      homeTimezone: "Europe/Zurich",
      currentTimezone: "Asia/Tokyo",
      currentCityUntil: "2026-10-20",
    },
    now,
  ) === "Asia/Tokyo",
);
check(
  "the trip's last day still counts",
  effectiveTimeZone(
    {
      homeTimezone: "Europe/Zurich",
      currentTimezone: "Asia/Tokyo",
      currentCityUntil: "2026-10-15",
    },
    now,
  ) === "Asia/Tokyo",
);
check(
  "after the trip → home again",
  effectiveTimeZone(
    {
      homeTimezone: "Europe/Zurich",
      currentTimezone: "Asia/Tokyo",
      currentCityUntil: "2026-10-01",
    },
    now,
  ) === "Europe/Zurich",
);
check(
  "a bad stored zone is ignored",
  effectiveTimeZone({ homeTimezone: "nowhere" }, now) === "Europe/Zurich",
);

console.log(`\nnow-line: ${passed} passed`);
