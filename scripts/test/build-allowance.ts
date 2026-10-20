/**
 * Builds on Loki's engine are a number, never an open-ended bill: welcome
 * builds first under a cap in francs, then the plan's monthly builds, then
 * the person's own engine. Run: npx tsx scripts/test/build-allowance.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAllowance, RUN_ENGINE } from "../../src/lib/build-engine/allowance";
import { PLAN_LIMITS } from "../../src/lib/plan";
import {
  CHF_PER_USD,
  WELCOME_BUILDS,
  WELCOME_MONTHLY_CAP_CHF,
} from "../../src/config/welcome-changes";

const now = new Date("2026-10-20T10:00:00Z");
const free = { plan: "free" as const, planStatus: null, planExpiresAt: null };
const pro = {
  plan: "pro" as const,
  planStatus: "active" as const,
  planExpiresAt: new Date("2026-11-19"),
};
const base = { welcomeUsed: 0, planUsedThisMonth: 0, welcomeSpendUsdThisMonth: 0, now };

// A newcomer: welcome builds, then nothing on Free.
assert.equal(WELCOME_BUILDS, 3);
let a = buildAllowance({ ...base, account: free });
assert.equal(a.engine, RUN_ENGINE.LOKI_WELCOME);
assert.equal(a.welcomeLeft, 3);
a = buildAllowance({ ...base, account: free, welcomeUsed: 3 });
assert.equal(a.engine, null);
assert.match(a.reason!, /welcome builds are used up/);
assert.match(a.reason!, /own sign-in or key/, "the way forward is named");

// The cap in francs stops welcome builds for everyone, and says so.
assert.equal(WELCOME_MONTHLY_CAP_CHF, 20);
a = buildAllowance({
  ...base,
  account: free,
  welcomeSpendUsdThisMonth: WELCOME_MONTHLY_CAP_CHF / CHF_PER_USD,
});
assert.equal(a.engine, null);
assert.match(a.reason!, /for everyone this month/);

// A plan: its builds a month after the welcome ones; past them, its own engine.
assert.equal(PLAN_LIMITS.buildsMonthly.free, 0);
assert.equal(PLAN_LIMITS.buildsMonthly.pro, 40);
a = buildAllowance({ ...base, account: pro, welcomeUsed: 3 });
assert.equal(a.engine, RUN_ENGINE.LOKI_PLAN);
assert.equal(a.planLeft, 40);
a = buildAllowance({ ...base, account: pro, welcomeUsed: 3, planUsedThisMonth: 40 });
assert.equal(a.engine, null);
assert.match(a.reason!, /40 builds on Loki's engine are used up/);
// A lapsed plan has none.
a = buildAllowance({
  ...base,
  account: { ...pro, planExpiresAt: new Date("2026-10-01") },
  welcomeUsed: 3,
});
assert.equal(a.engine, null);
assert.equal(a.planLeft, 0);

// The marker is written at open and counted from, and the pricing copy says the numbers.
assert.match(
  read("src/lib/inject-core.ts"),
  /engine: engine\.engine/,
  "every run records its engine",
);
assert.match(
  read("src/lib/inject-core.ts"),
  /code: "engine-exhausted"/,
  "a refusal, not a silent queue",
);
assert.match(read("src/config/plans.ts"), /builds a month on Loki's engine; no limit on your own/);
assert.match(read("content/whitepaper.md"), /Three welcome builds run on Loki's engine/);

console.log("✓ build allowance: welcome, then the plan, then your own — in numbers");
function read(p: string) {
  return readFileSync(p, "utf8");
}
