/**
 * One door to a person's Telegram: lib/notify/deliver.ts.
 *
 * Every sender goes through deliverNotice (or lib/notify/person.ts), so each
 * person's Settings choices, their own linked chat, the one-tap rule, the caps
 * and the quiet nights apply to all of Loki. On 2026-11-02 a review found a
 * dozen senders calling sendTelegramMessage themselves — with no caps, and two
 * sending other customers' news to the owner. This keeps it from coming back.
 *
 * Run: npx tsx scripts/test/one-telegram-door.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const ALLOWED = new Set([
  "src/lib/actions/telegram-send.ts", // defines them
  "src/lib/notify/deliver.ts", // the door
  "src/lib/telegram/send-to-person.ts", // the door's per-person half
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const offenders: string[] = [];
for (const file of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, file);
  if (ALLOWED.has(rel)) continue;
  const src = readFileSync(file, "utf8");
  if (
    /\b(sendTelegramMessage|sendTelegramVoice)\s*\(/.test(src) ||
    /api\.telegram\.org/.test(src)
  ) {
    if (rel.startsWith("src/lib/telegram/") || rel.startsWith("src/app/api/telegram/")) continue;
    offenders.push(rel);
  }
}

console.log("one-telegram-door:");
if (offenders.length) {
  console.log("  ✗ these send to Telegram without the gateway — use deliverNotice / notifyPerson:");
  for (const o of offenders) console.log(`      ${o}`);
  process.exit(1);
}
console.log("  ✓ every Telegram message in the app goes through lib/notify/deliver.ts");
