import type { Plan, PlanStatus } from "@/db/schema/users";
import { PLAN_LIMITS } from "@/lib/plan";
import { CHF_PER_USD, WELCOME_BUILDS, WELCOME_MONTHLY_CAP_CHF } from "@/config/welcome-changes";

/** Which engine paid for a run — recorded on the run (payload.engine). */
export const RUN_ENGINE = {
  /** The person's own sign-in or key. Never counted, never capped. */
  OWN: "own",
  /** Loki's key, one of the account's welcome builds. */
  LOKI_WELCOME: "loki-welcome",
  /** Loki's key, one of the plan's builds this month. */
  LOKI_PLAN: "loki-plan",
} as const;
export type RunEngine = (typeof RUN_ENGINE)[keyof typeof RUN_ENGINE];

export type BuildAllowanceInput = {
  account: { plan: Plan; planStatus: PlanStatus | null; planExpiresAt: Date | null };
  /** Welcome builds this account has run, ever. */
  welcomeUsed: number;
  /** Plan builds this account has run this calendar month. */
  planUsedThisMonth: number;
  /** What welcome builds cost Loki this month, across every account, in USD. */
  welcomeSpendUsdThisMonth: number;
  now: Date;
};

export type BuildAllowance = {
  /** The engine the next build on Loki's key would run on, or null: none left. */
  engine: typeof RUN_ENGINE.LOKI_WELCOME | typeof RUN_ENGINE.LOKI_PLAN | null;
  welcomeLeft: number;
  planLeft: number;
  /** Why there is none, in the person's words. */
  reason: string | null;
};

/**
 * What an account may still build on Loki's engine. Pure. Welcome builds
 * first (they are the newcomer's, and the cap in francs is checked on them
 * alone), then the plan's monthly builds while the plan is live.
 */
export function buildAllowance(input: BuildAllowanceInput): BuildAllowance {
  const welcomeLeft = Math.max(0, WELCOME_BUILDS - input.welcomeUsed);
  const capReached = input.welcomeSpendUsdThisMonth * CHF_PER_USD >= WELCOME_MONTHLY_CAP_CHF;
  const planLive =
    input.account.planStatus !== "past_due" &&
    !(input.account.planExpiresAt && input.account.planExpiresAt.getTime() <= input.now.getTime());
  const planLeft = planLive
    ? Math.max(0, PLAN_LIMITS.buildsMonthly[input.account.plan] - input.planUsedThisMonth)
    : 0;

  if (welcomeLeft > 0 && !capReached)
    return { engine: RUN_ENGINE.LOKI_WELCOME, welcomeLeft, planLeft, reason: null };
  if (planLeft > 0) return { engine: RUN_ENGINE.LOKI_PLAN, welcomeLeft, planLeft, reason: null };
  const reason =
    welcomeLeft > 0 && capReached
      ? "Loki's welcome builds are used up for everyone this month. Build on your own sign-in or key, or try again next month."
      : PLAN_LIMITS.buildsMonthly[input.account.plan] > 0 && planLive
        ? `Your plan's ${PLAN_LIMITS.buildsMonthly[input.account.plan]} builds on Loki's engine are used up this month. Build on your own sign-in or key until it resets.`
        : "Your welcome builds are used up. Build on your own sign-in or key, or choose a plan with builds on Loki's engine.";
  return { engine: null, welcomeLeft, planLeft, reason };
}
