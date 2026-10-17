import { planAiTokensMonthly } from "@/lib/plan";
import type { Plan, PlanStatus } from "@/db/schema/users";

/**
 * How much of a paid plan's monthly AI allowance is left.
 *
 * The allowance is what a paid plan buys on the chat: past the free pool's
 * daily share, a person on Personal, Pro or Team is still admitted while
 * their month's answers last (lib/ai-budget/gate.ts asks only after the share
 * has said no, so a free turn never pays for this read). Counted against the
 * same per-day ledger as the share, summed over the UTC month.
 *
 * A plan that has lapsed, or is past due, has no allowance: the expiry cron
 * reverts it to free, and this must not lag that cron by a day.
 *
 * Pure apart from the lazily-loaded reads below.
 */
export function allowanceLeft(
  account: { plan: Plan; planStatus: PlanStatus | null; planExpiresAt: Date | null },
  monthSpentTokens: number,
  now: Date,
): number {
  if (account.planStatus === "past_due") return 0;
  if (account.planExpiresAt && account.planExpiresAt.getTime() <= now.getTime()) return 0;
  return Math.max(0, planAiTokensMonthly(account.plan) - monthSpentTokens);
}

/** The reads behind `allowanceLeft`, imported lazily for the gate's reasons. */
export async function readAllowanceLeft(userId: string, now: Date): Promise<number> {
  const [{ getUserById }, { getMonthSpendTokens }] = await Promise.all([
    import("@/db/queries/users"),
    import("@/db/queries/ai-spend"),
  ]);
  const user = await getUserById(userId);
  if (!user || planAiTokensMonthly(user.plan) === 0) return 0;
  const spent = await getMonthSpendTokens(userId, now);
  return allowanceLeft(
    {
      plan: user.plan,
      planStatus: user.planStatus ?? null,
      planExpiresAt: user.planExpiresAt ?? null,
    },
    spent,
    now,
  );
}
