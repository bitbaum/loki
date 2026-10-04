/**
 * "What needs me" has one owner.
 *
 * Measured on production 2026-10-01: Today said "8 things need you", Control's
 * panel "Needs you 7", Activity "4 things need you", Approvals "7 proposed
 * actions". Four answers to one question, because four surfaces counted four
 * different things under the same words. lib/needs-you.ts now composes the
 * front door's list, and every other surface names its own part.
 *
 * Run: npx tsx scripts/test/needs-you-one-owner.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  composeNeedsYou,
  needsYouHeadline,
  NEEDS_YOU_LABELS,
  type NeedsYouInputs,
} from "@/lib/needs-you";
import { ALERT_TYPE_IDS, alertRestatesListedSource } from "@/config/alert-types";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (!ok) failed++;
}

const base: NeedsYouInputs = {
  projects: [{ id: "p1", name: "evig", reason: "Email verification bypass", href: "/projects/p1" }],
  approvals: {
    count: 7,
    locked: false,
    checkinNames: ["Jonathan", "Bryan", "Kris", "Kyle", "Derek", "Yusha"],
    others: [{ id: "a1", title: "Send Manuel the video" }],
  },
  feedbackCount: 6,
  widgetCount: 1,
  alerts: [
    {
      id: "x1",
      title: "28 feedback items need you",
      description: "…",
      href: "/feedback",
      urgent: true,
    },
  ],
  systemAlertCount: 4,
};

console.log("needs-you-one-owner:");

{
  const { items, total } = composeNeedsYou(base);
  check(
    "the total is the sum of the counted rows' weights — no second count",
    total === items.filter((i) => i.tier !== "tidy").reduce((s, i) => s + i.weight, 0),
  );
  // 1 project + 6 people + 1 approval + 6 feedback + 1 alert. The missing
  // widget is housekeeping (tier "tidy"): listed on the Also line, not counted.
  check("everything the operator owns is counted once", total === 15, `total was ${total}`);
  check(
    "system alarms are linked, not counted",
    !items.some((i) => i.key.startsWith("system")) && total === 15,
  );
  check(
    "a missing widget is housekeeping, not need",
    items.find((i) => i.key === "widget")?.tier === "tidy",
  );
  const people = items.find((i) => i.key === "approvals:checkins");
  check(
    "six check-ins collapse into one row that carries their weight",
    people?.label === "Reach out to 6 people" && people.weight === 6 && people.detail?.length === 6,
  );
  check("an urgent alert comes first", items[0]?.key === "alert:x1");
}

{
  const { items, total } = composeNeedsYou({
    ...base,
    approvals: { count: 7, locked: true, checkinNames: [], others: [] },
  });
  const locked = items.find((i) => i.key === "approvals:locked");
  check(
    "behind the PIN, approvals are one row with only their count",
    locked?.weight === 7 && !locked.detail && total === 1 + 7 + 6 + 1,
  );
}

{
  const { items, total } = composeNeedsYou({
    projects: [],
    approvals: { count: 0, locked: false, checkinNames: [], others: [] },
    feedbackCount: 0,
    widgetCount: 0,
    alerts: [],
    systemAlertCount: 3,
  });
  check("nothing to do reads as zero even with system alarms", items.length === 0 && total === 0);
}

// Tiers, measured 2026-10-04: "17 things need you" for one security hole,
// seven approvals, eight reports and a missing widget, at one weight.
{
  const { items, total, urgent } = composeNeedsYou({
    ...base,
    projects: [
      { id: "ok", name: "heidi", reason: "Broken export", href: "/projects/ok" },
      {
        id: "sec",
        name: "evig",
        reason: "Email verification bypass…",
        fullReason: "Email verification bypass: anyone can register @revamp-it.ch and get Staff",
        href: "/projects/sec",
        urgent: true,
      },
    ],
    alerts: [],
  });
  check(
    "a security flag is urgent and leads, ahead of other flags",
    items[0]?.key === "project:sec" && items[0]?.tier === "urgent",
  );
  check(
    "the urgent row carries the whole sentence, not the 90-character cut",
    items[0]?.detail?.[0]?.includes("get Staff") === true,
  );
  check(
    "the headline leads with what is urgent",
    needsYouHeadline(total, urgent) === `1 urgent · ${total - 1} waiting on you`,
    needsYouHeadline(total, urgent),
  );
  check("no urgency, plain count", needsYouHeadline(3, 0) === "3 things need you");
  check("one thing is singular", needsYouHeadline(1, 0) === "1 thing needs you");
  check("nothing is said plainly", needsYouHeadline(0, 0) === "Nothing needs you.");
}

{
  const { items, total } = composeNeedsYou({
    projects: [],
    approvals: { count: 0, locked: false, checkinNames: [], others: [] },
    feedbackCount: 0,
    widgetCount: 2,
    alerts: [],
    systemAlertCount: 0,
  });
  check(
    "housekeeping alone is not a reason to say something needs you",
    total === 0 && items.length === 1,
  );
}

// An alert that only announces a source the list composes directly is not a
// second row. Live 2026-10-02: "22 things need you" carried "7 actions are
// waiting for your approval" beside the seven approvals, and "36 feedback items
// need triage" beside "6 to triage".
{
  check(
    "the approvals and new-feedback alerts are marked as restating a listed source",
    alertRestatesListedSource("pending_approvals") && alertRestatesListedSource("new_feedback"),
  );
  check(
    "alerts that report something new are not swallowed",
    ["run_escalation", "goal_capped", "fix_deploy_failed", "studio_request"].every(
      (t) => ALERT_TYPE_IDS.includes(t as never) && !alertRestatesListedSource(t),
    ),
  );
  const server = readFileSync(join(__dirname, "../../src/lib/needs-you-server.ts"), "utf8");
  check(
    "the front door filters restating alerts out of its rows",
    /alertRestatesListedSource\(a\.type\)/.test(server),
  );
}

// Only the front door may SAY "N things need you"; the others use their own words.
{
  const root = join(__dirname, "../..");
  const owners = new Set(["src/components/today/NeedsYouVerdict.tsx", "src/lib/needs-you.ts"]);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name)) {
        const rel = relative(root, p);
        if (owners.has(rel)) continue;
        // Strip comments: the history of the bug is allowed to be written down.
        const code = readFileSync(p, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        if (/[`"'][^`"'\n]*\bthings? needs? you\b/i.test(code)) offenders.push(rel);
      }
    }
  };
  walk(join(root, "src"));
  check(
    'only the front door renders "N things need you"',
    offenders.length === 0,
    offenders.join(", "),
  );
  check(
    "the other surfaces' labels name their part",
    NEEDS_YOU_LABELS.review !== "Needs you" && /run/i.test(NEEDS_YOU_LABELS.runs),
  );
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
