// The usage summary Loki reads: per surface, shown vs tapped, the kinds offered
// and never taken, the window honoured, the registered-but-silent surface
// reported as never shown, and the registry refusing what it does not list.
// Run: npx tsx scripts/test/usage-summary.ts
import assert from "node:assert/strict";
import { summarizeUsage, usageLine, kindOf, type UsageEventLike } from "@/lib/usage/summarize";
import {
  USAGE_SURFACES,
  USAGE_SURFACE_IDS,
  allowsUsageAction,
  isUsageSurface,
} from "@/config/usage-surfaces";
import { planRetrieval } from "@/lib/agent/plan";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

const now = new Date("2026-10-11T12:00:00Z");
const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000);
const ev = (over: Partial<UsageEventLike> & { action: string }): UsageEventLike => ({
  surface: "loki.build-next",
  target: null,
  meta: null,
  createdAt: at(1),
  ...over,
});

check("the registry is the only list, and it refuses what it does not name", () => {
  assert.ok(USAGE_SURFACE_IDS.includes("loki.build-next"));
  assert.ok(isUsageSurface("loki.build-next"));
  assert.ok(allowsUsageAction("loki.build-next", "tap"));
  assert.equal(allowsUsageAction("loki.build-next", "dismiss"), false, "not in its actions");
  assert.equal(allowsUsageAction("loki.something-else", "tap"), false);
  assert.equal(allowsUsageAction("__proto__", "tap"), false);
  for (const spec of Object.values(USAGE_SURFACES)) assert.ok(spec.path.startsWith("/"));
});

check("a registered surface with no rows is reported as never shown", () => {
  const [s] = summarizeUsage([], { now });
  assert.ok(s);
  assert.equal(s.surface, "loki.build-next");
  assert.equal(s.verdict, "never shown");
  assert.match(usageLine(s), /not shown once/);
});

check("shown vs tapped, with the kinds offered and never taken", () => {
  const shown = (h: number) =>
    ev({ action: "shown", createdAt: at(h), meta: { kinds: ["fix", "demand", "idea"], ids: [] } });
  const events = [
    shown(30),
    shown(20),
    shown(10),
    ev({ action: "tap", target: "fix:sink", createdAt: at(19) }),
    ev({ action: "tap", target: "fix:sink", createdAt: at(9) }),
    ev({ action: "tap", target: "idea:booking page", createdAt: at(8) }),
    ev({ action: "rotate", createdAt: at(9.5) }),
  ];
  const [s] = summarizeUsage(events, { now });
  assert.equal(s.shown, 3);
  assert.equal(s.taps, 3);
  assert.equal(s.rotates, 1);
  assert.equal(s.tapRate, 1);
  assert.equal(s.verdict, "used");
  assert.deepEqual(s.neverTapped, ["demand"], "offered three times, tapped never");
  assert.deepEqual(s.topTargets[0], { target: "fix:sink", taps: 2 });
  assert.equal(s.kinds.find((k) => k.kind === "fix")?.taps, 2);
  assert.equal(s.lastTapAt?.toISOString(), at(8).toISOString());
  const line = usageLine(s);
  assert.match(line, /shown 3×, tapped 3×/);
  assert.match(line, /never tapped: demand/);
  assert.match(line, /fix:sink \(2\)/);
});

check("a kind offered once and not tapped is not yet 'never tapped'", () => {
  const [s] = summarizeUsage([ev({ action: "shown", meta: { kinds: ["goal"] } })], { now });
  assert.deepEqual(s.neverTapped, [], "one offer is not a pattern");
  assert.equal(s.verdict, "shown, never used");
});

check("the window is honoured: old rows and future rows do not count", () => {
  const [s] = summarizeUsage(
    [
      ev({ action: "tap", target: "fix:a", createdAt: at(24 * 15) }),
      ev({ action: "tap", target: "fix:b", createdAt: at(-1) }),
      ev({ action: "tap", target: "fix:c", createdAt: at(24 * 13) }),
    ],
    { now, days: 14 },
  );
  assert.equal(s.taps, 1);
  assert.equal(s.days, 14);
});

check("an unregistered surface's rows are still summarised, after the registered ones", () => {
  const out = summarizeUsage([ev({ surface: "loki.retired-row", action: "tap", target: "x:y" })], {
    now,
  });
  assert.equal(out[0].surface, "loki.build-next");
  assert.deepEqual(
    out.slice(0, USAGE_SURFACE_IDS.length).map((s) => s.surface),
    USAGE_SURFACE_IDS,
  );
  const retired = out[USAGE_SURFACE_IDS.length];
  assert.equal(retired.surface, "loki.retired-row");
  assert.equal(retired.label, "loki.retired-row");
  assert.equal(retired.path, null);
});

check("kindOf reads the part before the first colon", () => {
  assert.equal(kindOf("deadline:pay rent: friday"), "deadline");
  assert.equal(kindOf("starter"), "starter");
});

check("Loki plans usage when asked about use, and alongside build advice", () => {
  assert.equal(planRetrieval("how am I using Build next?").sources[0], "usage");
  assert.ok(planRetrieval("which suggestions do I actually tap").sources.includes("usage"));
  const build = planRetrieval("what should I build next?").sources;
  assert.equal(build[0], "builds");
  assert.ok(build.includes("usage"), "a recommendation reads what gets tapped");
  assert.ok(!planRetrieval("who is Elena").sources.includes("usage"));
});

console.log(`\n${passed} checks passed`);
