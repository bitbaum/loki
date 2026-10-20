import type { Plan } from "@/db/schema/users";

export const PLAN_LIMITS = {
  projects: {
    free: 3,
    personal: 5,
    pro: Infinity,
    team: Infinity,
  },
  /**
   * Loki answers a month past the free pool's daily share (lib/ai-budget/gate.ts).
   *
   * Free has none: it lives on the shared daily pool and the person's own key.
   * The paid figures are sized so the AI under them costs a fraction of the
   * price: an answer is ~8,000 tokens, which on a paid open model (gpt-oss-120b
   * at Groq's list price, Oct 2026: $0.15 in / $0.60 out per million) is about
   * $0.002 — so Personal's 1,000 is ~$2 against CHF 15, Team's 8,000 ~$16
   * against CHF 90. A Team's allowance is the account's, shared by its seats.
   */
  aiAnswersMonthly: {
    free: 0,
    personal: 1_000,
    pro: 3_000,
    team: 8_000,
  },
  /**
   * Builds a month on LOKI'S engine (docs/master-plan-2026-10.md decision 6):
   * a bounded number, never an open-ended model bill. Past it, and on Free
   * past the welcome builds (config/welcome-changes.ts), the person builds on
   * their own sign-in or key, which no plan limits. First figures; re-read
   * against the real cost per build on System → Capacity.
   */
  buildsMonthly: {
    free: 0,
    personal: 10,
    pro: 40,
    team: 100,
  },
} satisfies Record<string, Record<Plan, number>>;

/** What one plan answer is counted as, against the monthly allowance. */
export const PLAN_TOKENS_PER_ANSWER = 8_000;

export function getProjectLimit(plan: Plan): number {
  return PLAN_LIMITS.projects[plan];
}

/** True when limit should be shown as "Unlimited" rather than a number. */
export function isUnlimitedProjects(plan: Plan): boolean {
  return !Number.isFinite(PLAN_LIMITS.projects[plan]);
}

/** The plan's monthly AI allowance in tokens, as the gate counts it. */
export function planAiTokensMonthly(plan: Plan): number {
  return PLAN_LIMITS.aiAnswersMonthly[plan] * PLAN_TOKENS_PER_ANSWER;
}
