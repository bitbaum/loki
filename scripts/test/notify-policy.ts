/**
 * The owner's Telegram contract (src/lib/notify/policy.ts). Each case is a
 * message that actually reached his phone, or the rule that stops it.
 *
 * Run: npx tsx scripts/test/notify-policy.ts
 */
import {
  decideDelivery,
  formatNotice,
  isQuietHour,
  PER_DAY,
  PER_SOURCE_PER_HOUR,
  reminderWaitMs,
  validateNotice,
  type NoticeRequest,
} from "@/lib/notify/policy";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}`);
  }
}

const open = { label: "Open the fix", url: "https://loki.orangecat.ch/feedback/1" };
const base: NoticeRequest = {
  source: "box",
  title: "orangecat is down",
  actions: [open],
  urgency: "now",
};
const none = { lastForKey: null, sourceLastHour: 0, lastDay: 0 };
// 2026-11-02 12:00 Zurich (UTC+1) and 03:00 Zurich.
const NOON = Date.UTC(2026, 10, 2, 11, 0);
const NIGHT = Date.UTC(2026, 10, 2, 2, 0);

console.log("notify-policy:");

// Rule 1 — the 2026-11-02 night: "⚙️ STILL FAILING: run-p1977852-i194871759", no action anywhere.
const noAction = validateNotice({
  ...base,
  title: "STILL FAILING: run-p1977852-i194871759",
  actions: [],
});
check(
  "a notice with no button is refused (and says why)",
  !noAction.ok && /not actionable/.test(noAction.reason),
);
check(
  "a button without a link does not count as an action",
  !validateNotice({ ...base, actions: [{ label: "Open", url: "" }] }).ok,
);
check(
  "a button must link to https (no javascript:, no plain http)",
  !validateNotice({ ...base, actions: [{ label: "Open", url: "http://x" }] }).ok,
);
check("an actionable notice is accepted", validateNotice(base).ok);

// Rule 2 — one screen.
check(
  "four buttons are refused",
  !validateNotice({ ...base, actions: [open, open, open, open] }).ok,
);
check(
  "a 25-character label is refused",
  !validateNotice({ ...base, actions: [{ label: "x".repeat(25), url: open.url }] }).ok,
);

// Rule 3 — one incident, one message, backing off.
check("first reminder waits 30 min", reminderWaitMs(1) === 30 * 60_000);
check(
  "then 2 h, then 8 h",
  reminderWaitMs(2) === 2 * 3600_000 && reminderWaitMs(3) === 8 * 3600_000,
);
check("and never more than a day", reminderWaitMs(9) === 24 * 3600_000);
const held = decideDelivery(
  base,
  { ...none, lastForKey: { at: NOON - 10 * 60_000, count: 1 } },
  NOON,
);
check("the same key ten minutes later is held", !held.deliver && held.reason === "held-reminder");
const again = decideDelivery(
  base,
  { ...none, lastForKey: { at: NOON - 31 * 60_000, count: 1 } },
  NOON,
);
check("…and reminded after 30 minutes", again.deliver);

const onceHeld = decideDelivery(
  { ...base, once: true },
  { ...none, lastForKey: { at: NOON - 40 * 86400_000, count: 1 } },
  NOON,
);
check("a once-only notice (the voice pitch) is never repeated", !onceHeld.deliver);

// Rule 4 — a looping sender cannot bombard.
const capped = decideDelivery(base, { ...none, sourceLastHour: PER_SOURCE_PER_HOUR }, NOON);
check(
  "a fourth message from one source in an hour goes to the list",
  !capped.deliver && capped.reason === "source-cap",
);
const daily = decideDelivery(base, { ...none, lastDay: PER_DAY }, NOON);
check(
  "past the daily cap everything goes to the list",
  !daily.deliver && daily.reason === "daily-cap",
);

// Rule 5 — sound only for "now", never at night.
const ringNoon = decideDelivery(base, none, NOON);
check("a 'now' notice at noon rings", ringNoon.deliver && ringNoon.ring);
const ringNight = decideDelivery(base, none, NIGHT);
check("the same notice at 03:00 arrives silently", ringNight.deliver && !ringNight.ring);
const today = decideDelivery({ ...base, urgency: "today" }, none, NOON);
check("a 'today' notice never rings", today.deliver && !today.ring);
check("03:00 Zurich is a quiet hour, noon is not", isQuietHour(NIGHT) && !isQuietHour(NOON));

check(
  "the message carries no machine name, only what happened",
  formatNotice({ ...base, source: "orangecat-cat" }) === "orangecat is down",
);

if (failures) {
  console.log(`\n  ${failures} failure(s)`);
  process.exit(1);
}
