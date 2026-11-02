/**
 * Each person chooses which kinds of message reach their Telegram
 * (config/notify-categories.ts); the gateway files every notice under a kind
 * (lib/notify/policy.ts categoryOf).
 *
 * Run: npx tsx scripts/test/notify-categories.ts
 */
import {
  categoriesFor,
  isCategoryOn,
  NOTIFY_CATEGORIES,
  NOTIFY_CATEGORY_IDS,
} from "@/config/notify-categories";
import { categoryOf } from "@/lib/notify/policy";
import { startLink } from "@/lib/telegram/notify-bot";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}`);
  }
}
console.log("notify-categories:");

check(
  "a person with no choices gets every kind's default",
  NOTIFY_CATEGORY_IDS.every((c) => isCategoryOn({}, c) === NOTIFY_CATEGORIES[c].defaultOn),
);
check("a kind turned off stays off", !isCategoryOn({ people: false }, "people"));
check("a kind turned on stays on", isCategoryOn({ plans: true }, "plans"));
check("a customer is not offered the server kind", !categoriesFor(false).includes("servers"));
check("the operator is", categoriesFor(true).includes("servers"));
check(
  "every kind has words a person can read",
  NOTIFY_CATEGORY_IDS.every(
    (c) => NOTIFY_CATEGORIES[c].label.length > 3 && NOTIFY_CATEGORIES[c].note.length > 10,
  ),
);

check("the box files under servers", categoryOf({ source: "box" }) === "servers");
check(
  "OrangeCat's bots file under other assistants",
  categoryOf({ source: "orangecat-cat" }) === "bots",
);
check(
  "an explicit kind wins",
  categoryOf({ source: "box", category: "decisions" }) === "decisions",
);

process.env.TELEGRAM_NOTIFY_BOT_USERNAME = "@LokiNoticesBot";
check(
  "the connect link opens the bot with the code",
  startLink("abc_123") === "https://t.me/LokiNoticesBot?start=abc_123",
);

if (failures) {
  console.log(`\n  ${failures} failure(s)`);
  process.exit(1);
}
