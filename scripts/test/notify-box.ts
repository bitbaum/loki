/**
 * Box lines → notices (src/lib/notify/box.ts). Every line below reached the
 * owner's phone on the night of 2026-11-01; only an intrusion may now.
 *
 * Run: npx tsx scripts/test/notify-box.ts
 */
import { boxKey, boxNotice, isIntrusion } from "@/lib/notify/box";
import { validateNotice } from "@/lib/notify/policy";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}`);
  }
}
const APP = "https://loki.orangecat.ch";
console.log("notify-box:");

const noise = [
  "⚙️ STILL FAILING: run-p1977852-i194871759; run-p1977874-i194871764",
  "⚙️ STILL FAILING: appcron-substrata-sweep",
  "✅ RECOVERED: appcron-substrata-auto-updates",
  "📝 2 SENSITIVE FILE(S) CHANGED: edited /etc/caddy/apps.d/petvity.caddy, edited /etc/systemd/system/petvity-app.service. If this was you or a deploy, ignore.",
  "🧩 reparaturbonus-zh: unit is enabled but inactive",
  "✅ RECOVERED: keller",
  "🔴 DOWN: orangecat-app.service — fetch failed → 🤖 fix agent dispatched (orangecat)",
];
for (const line of noise) {
  const n = boxNotice(line, APP);
  check(
    `list only, never the phone: ${line.slice(0, 48)}`,
    !validateNotice(n).ok && n.urgency === "today",
  );
}

const intrusion = boxNotice("🚨 SSH PASSWORD LOGIN ACCEPTED for root from 1.2.3.4", APP);
check(
  "an accepted SSH password login is actionable and urgent",
  validateNotice(intrusion).ok && intrusion.urgency === "now",
);
check("its button opens the evidence on /system", intrusion.actions[0]?.url === `${APP}/system`);
check("a suspicious process is an intrusion", isIntrusion("☠️ SUSPICIOUS PROCESS: /tmp/x (pid 1)"));
check("a disk warning is not", !isIntrusion("💾 DISK 87% on / (>85%)"));

const rescale = boxNotice(
  "🟢 Hetzner: cx43 (16GB) is AVAILABLE to rescale bitbaum in fsn1 NOW.",
  APP,
);
check(
  "a rescale window is actionable: one button to the Hetzner Console",
  validateNotice(rescale).ok && rescale.actions.length === 1,
);

check(
  "the same kind of line folds into one row",
  boxKey("⚙️ STILL FAILING: run-p1-i2") === boxKey("⚙️ STILL FAILING: run-p3-i4"),
);
check(
  "different apps' findings stay separate rows",
  boxKey("🧩 keller: unit is enabled but inactive") !==
    boxKey("🧩 sbb-fundbuero: unit is enabled but inactive"),
);

if (failures) {
  console.log(`\n  ${failures} failure(s)`);
  process.exit(1);
}
