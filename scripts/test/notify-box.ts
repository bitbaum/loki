/**
 * Box lines → notices (src/lib/notify/box.ts). Every line below reached the
 * owner's phone on the night of 2026-11-01; only an intrusion may now.
 *
 * Run: npx tsx scripts/test/notify-box.ts
 */
import { readFileSync } from "node:fs";
import { boxKey, boxNotice, isIntrusion } from "@/lib/notify/box";
import { validateNotice } from "@/lib/notify/policy";
import { bellWords } from "@/lib/notify/intrusion-words";

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
check("its button opens the list it is on (/today)", intrusion.actions[0]?.url === `${APP}/today`);
check("it names the machine", intrusion.title.includes("bitbaum"));
check(
  "its title is words, not the server's line",
  intrusion.title === "Someone signed in to bitbaum with a password",
);
check(
  "the raw line is kept, behind a blank line (Details)",
  /\n\n🚨 SSH PASSWORD LOGIN ACCEPTED for root from 1\.2\.3\.4$/.test(intrusion.body ?? ""),
);
{
  const proc = boxNotice(
    "☠️ SUSPICIOUS PROCESS: pid 951241 running /tmp/x/esbuild. Kill it: sudo kill -9 951241",
    APP,
  );
  check(
    "a suspicious process reads plainly, with no pid or command in the title",
    proc.title === "An unexpected program ran on bitbaum" && !/\d|sudo|☠/.test(proc.title),
  );
}
{
  // A row recorded before the plain titles reads the same way in the bell.
  const legacy = bellWords({
    title: "bitbaum: ☠️ SUSPICIOUS PROCESS",
    description: "pid 951241 running /tmp/x. Kill it: sudo kill -9 951241",
  });
  check(
    "an old intrusion row reads plainly too",
    legacy.title === "An unexpected program ran on bitbaum",
  );
  const other = { title: "Deploy finished", description: "ok" };
  check("any other row is shown as stored", bellWords(other) === other);
}
check(
  "two different intrusion lines are two notices, not a held reminder",
  boxNotice("🚨 SSH PASSWORD LOGIN ACCEPTED for root from 1.2.3.4", APP).key !==
    boxNotice("🚨 SSH PASSWORD LOGIN ACCEPTED for root from 5.6.7.8", APP).key,
);
check(
  "an SSH login from a new address is an intrusion sign",
  isIntrusion("🔑 SSH LOGIN as root from 9.9.9.9"),
);
check(
  "an edited authorized_keys is an intrusion sign; a deploy's unit file is not",
  isIntrusion("📝 1 SENSITIVE FILE(S) CHANGED: edited /root/.ssh/authorized_keys") &&
    !isIntrusion("📝 1 SENSITIVE FILE(S) CHANGED: edited /etc/systemd/system/x.service"),
);

// The box's own copy (used when Loki is unreachable) must say the same.
{
  const lib = readFileSync("scripts/hetzner/install-host-alerts.sh", "utf8");
  const fn = lib.slice(lib.indexOf("_alert_intrusion() {"), lib.indexOf("_alert_loki_token() {"));
  for (const probe of [
    "SSH PASSWORD LOGIN",
    "🔑 SSH LOGIN",
    "☠️",
    "🔓 SSHD",
    "🧱 FIREWALL",
    "👤 NEW PRIVILEGED",
    "authorized_keys",
  ]) {
    check(`lib-alert's fallback list names ${probe}`, fn.includes(probe));
  }
}
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
