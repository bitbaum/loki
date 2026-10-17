/**
 * Paid plans, up to the moment of paying.
 *
 * Prices were set on 2026-10-17 (CHF 15 / 40 / 90) while payments stay off
 * until the company is registered. These pin what that must mean:
 *
 *   - past the daily free share, a paid plan's month still admits the turn,
 *     and a lapsed or past-due plan's does not;
 *   - Free has no allowance, and a failed allowance read never admits or
 *     breaks anything — the share's refusal stands;
 *   - the refusal offers the plans as well as the person's own key;
 *   - only priced paid plans can be reserved, and while no OrangeCat pass
 *     exists the plan's button reserves rather than pays.
 *
 * Pure: no database (the gate's reads are injected).
 */
import { checkAiBudget } from "@/lib/ai-budget/gate";
import { allowanceLeft } from "@/lib/ai-budget/plan-allowance";
import { planAiTokensMonthly, PLAN_LIMITS } from "@/lib/plan";
import { planCheckout, reservablePlan } from "@/lib/plan-reservation";
import { PRICING_PLANS } from "@/config/plans";

let passed = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (!cond)
    throw new Error(`✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

const NOW = new Date("2026-10-17T12:00:00Z");
const spentShare = async () => ({ userSpentTokens: 900_000, activeUsers: 1, userTurns: 100 });

async function main() {
  check(
    "prices are the founder's: 15 / 40 / 90",
    PRICING_PLANS.map((p) => p.priceMonthly).join() === "0,15,40,90",
  );
  check("Free has no monthly allowance", planAiTokensMonthly("free") === 0);
  check(
    "each paid plan carries more than the one below it",
    PLAN_LIMITS.aiAnswersMonthly.personal < PLAN_LIMITS.aiAnswersMonthly.pro &&
      PLAN_LIMITS.aiAnswersMonthly.pro < PLAN_LIMITS.aiAnswersMonthly.team,
  );

  const active = { plan: "personal" as const, planStatus: "active" as const, planExpiresAt: null };
  check(
    "an active plan's allowance is what is left of its month",
    allowanceLeft(active, 1_000_000, NOW) === planAiTokensMonthly("personal") - 1_000_000,
  );
  check("a spent month has nothing left", allowanceLeft(active, 99_000_000, NOW) === 0);
  check(
    "a lapsed pass has no allowance",
    allowanceLeft({ ...active, planExpiresAt: new Date(NOW.getTime() - 1) }, 0, NOW) === 0,
  );
  check(
    "a past-due plan has no allowance",
    allowanceLeft({ ...active, planStatus: "past_due" }, 0, NOW) === 0,
  );

  const refused = await checkAiBudget("u1", NOW, {
    timeZone: "UTC",
    capacity: () => 100_000,
    readUsage: spentShare,
    planAllowance: async () => 0,
  });
  check("on Free, a spent share refuses", !refused.allowed);
  check(
    "…and the refusal offers the person's own key and the plans",
    !refused.allowed &&
      /own model key/.test(refused.message) &&
      /\(\/pricing\)/.test(refused.message),
    refused,
  );

  const admitted = await checkAiBudget("u1", NOW, {
    timeZone: "UTC",
    capacity: () => 100_000,
    readUsage: spentShare,
    planAllowance: async () => 5_000_000,
  });
  check("a paid plan with allowance left is admitted past the share", admitted.allowed);

  const broken = await checkAiBudget("u1", NOW, {
    timeZone: "UTC",
    capacity: () => 100_000,
    readUsage: spentShare,
    planAllowance: async () => {
      throw new Error("connection refused");
    },
  });
  check("an allowance read that fails leaves the share's refusal standing", !broken.allowed);

  let asked = false;
  await checkAiBudget("u1", NOW, {
    timeZone: "UTC",
    capacity: () => 100_000,
    readUsage: async () => ({ userSpentTokens: 0, activeUsers: 1, userTurns: 0 }),
    planAllowance: async () => {
      asked = true;
      return 0;
    },
  });
  check("a turn inside the share never reads the plan", !asked);

  check(
    "only priced paid plans can be reserved",
    reservablePlan("personal") === "personal" &&
      reservablePlan("free") === null &&
      reservablePlan("enterprise") === null,
  );
  const personal = PRICING_PLANS.find((p) => p.key === "personal")!;
  const before = process.env.ORANGECAT_PAY_URL_PERSONAL;
  delete process.env.ORANGECAT_PAY_URL_PERSONAL;
  check("with no OrangeCat pass, the button reserves", planCheckout(personal).kind === "reserve");
  process.env.ORANGECAT_PAY_URL_PERSONAL = "https://orangecat.ch/pay/personal";
  const pay = planCheckout(personal);
  check(
    "once the pass exists, the same button pays",
    pay.kind === "pay" && pay.url.endsWith("/personal"),
  );
  if (before === undefined) delete process.env.ORANGECAT_PAY_URL_PERSONAL;
  else process.env.ORANGECAT_PAY_URL_PERSONAL = before;

  console.log(`\nplan-allowance: ${passed} checks passed`);
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
