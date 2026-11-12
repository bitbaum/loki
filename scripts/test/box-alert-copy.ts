/**
 * Box alarms in the owner's words (src/config/box-alert-copy.ts). The lines
 * below are the ones /system showed verbatim on 2026-11-12.
 *
 * Run: npx tsx scripts/test/box-alert-copy.ts
 */
import { boxKey, boxNotice } from "@/lib/notify/box";
import { plainBoxAlert, plainSystemAlerts, stripLeadingEmoji } from "@/config/box-alert-copy";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}`, detail ?? "");
  }
}
console.log("box-alert-copy:");

/** The row as lib/notify/box.ts stores it. */
function stored(line: string) {
  const n = boxNotice(line, "https://loki.orangecat.ch");
  return { title: n.title, description: n.body ?? null };
}

const JARGON =
  /STRANDED|unpushed|uncommitted|docker|sudo|kernel|GC\b|tier|env file|HTTP \d|#[0-9a-f]{6,}/;

const lines = {
  strandedBranches:
    "🧟 STRANDED agent work in loki-wt-scope — unpushed: fc/1840a4dd-fdd4-41ae-b42f-328c06cd0337(2), fix/embed-abandoned-requests(1). It exists only on the box; nobody can see it.",
  strandedDirty:
    "🧟 STRANDED agent work in solon — 3 uncommitted. It exists only on the box; nobody can see it.",
  container:
    "🐳 NEW CONTAINER: searxng searxng/searxng:latest. If not from a deploy: docker stop <name>",
  dependency:
    "🛡️ 1 NEW CRITICAL DEPENDENCY ALERT(S): orangecat:bitcoinjs-lib . Bump and deploy: https://github.com/orgs/bitbaum/security/alerts/dependabot?query=severity%3Acritical",
  disk: "🚨 DISK GC could not free space — still 93% and every safe tier is exhausted. Needs a bigger volume or fewer checkouts.",
  reboot:
    "♻️ REBOOT PENDING for 7 days (kernel/security patch not live until then). When convenient: sudo reboot — apps come back on their own",
  key: "🔑 gemini: DEAD API KEY #04b433f6 (HTTP 403) in: causius, heidi, loki. Replace GEMINI_API_KEY in each of those apps' env file (orangecat: /opt/orangecat/app/.env, others: /opt/<app>/shared/.env) and restart the app.",
};

for (const [name, line] of Object.entries(lines)) {
  const p = plainBoxAlert(stored(line));
  const summary = p.description.split(/\n\s*\n/)[0];
  check(
    `${name}: the title is plain words`,
    !JARGON.test(p.title) && !/^\p{Emoji_Presentation}/u.test(p.title),
    p.title,
  );
  check(`${name}: the summary is plain words`, !JARGON.test(summary), summary);
  check(
    `${name}: the raw line is kept behind Details`,
    p.description.includes("\n\n") && p.description.endsWith(stripLeadingEmoji(line)),
  );
  check(
    `${name}: one action hands it to Loki`,
    p.actionUrl.startsWith("/loki?q=") && p.actionLabel.startsWith("Ask Loki"),
  );
  check(
    `${name}: the ask carries the original line`,
    new URLSearchParams(p.actionUrl.split("?")[1]).get("q")?.includes(stripLeadingEmoji(line)) ===
      true,
  );
}

check(
  "a worktree is reported under its repository",
  plainBoxAlert(stored(lines.strandedBranches)).title === "Work in loki was never saved to GitHub",
);
check(
  "branches are counted, not listed",
  plainBoxAlert(stored(lines.strandedBranches)).description.startsWith(
    "2 branches never sent to GitHub.",
  ),
);
check(
  "uncommitted files are counted",
  plainBoxAlert(stored(lines.strandedDirty)).description.startsWith("3 changed files not saved."),
);
check(
  "the dependency names the library and the project",
  plainBoxAlert(stored(lines.dependency)).description.startsWith(
    "Affected: bitcoinjs-lib in orangecat.",
  ),
);
check(
  "the key names its provider and apps",
  plainBoxAlert(stored(lines.key)).title === "The Gemini key stopped working" &&
    plainBoxAlert(stored(lines.key)).description.startsWith("causius, heidi, loki can no longer"),
);
check(
  "an unknown line keeps its words without the emoji",
  plainBoxAlert({ title: "🧩 keller", description: "unit is enabled but inactive" }).title ===
    "keller",
);

// One row per thing to fix.
const rows = [
  { line: lines.disk, at: 3 },
  { line: lines.disk.replace("93%", "91%"), at: 2 },
  { line: lines.strandedBranches, at: 1 },
  { line: lines.strandedBranches.replace("loki-wt-scope", "loki-wt-keys"), at: 0 },
  { line: lines.reboot, at: -1 },
].map((r, i) => ({
  id: `a${i}`,
  severity: "info",
  actionUrl: null,
  metadata: { source: "box" },
  ...stored(r.line),
}));
const intrusion = {
  id: "x",
  severity: "urgent",
  actionUrl: "https://loki.orangecat.ch/today",
  metadata: { source: "box" },
  title: "bitbaum: 🚨 SSH PASSWORD LOGIN ACCEPTED for root",
  description: null,
};
const other = {
  id: "y",
  severity: "warning",
  actionUrl: "/projects",
  metadata: null,
  title: "Telemetry is silent",
  description: null,
};
const out = plainSystemAlerts([...rows, intrusion, other]);
check(
  "two disk alarms are one row, the newest",
  out.filter((a) => a.title.includes("disk")).length === 1 && out.some((a) => a.id === "a0"),
);
check(
  "one repository's worktrees are one row",
  out.filter((a) => a.title.startsWith("Work in loki")).length === 1,
);
check(
  "an intrusion keeps its own words and button",
  out.find((a) => a.id === "x")?.title === intrusion.title &&
    out.find((a) => a.id === "x")?.actionUrl === intrusion.actionUrl,
);
check(
  "an alarm that is not the box's is untouched",
  JSON.stringify(out.find((a) => a.id === "y")) ===
    JSON.stringify({ ...other, metadata: undefined }),
);
check(
  "no row carries its metadata to the client",
  out.every((a) => !("metadata" in a)),
);

check(
  "the stored key ignores numbers, so a repeat updates one row",
  boxKey(lines.disk) === boxKey(lines.disk.replace("93%", "91%")),
);

if (failures) {
  console.log(`\n  ${failures} failure(s)`);
  process.exit(1);
}
