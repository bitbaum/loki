import { getUserById } from "@/db/queries/users";
import { countRunsOnEngine, monthStart, welcomeSpendUsdThisMonth } from "@/db/queries/build-allowance";
import { buildAllowance, RUN_ENGINE, type BuildAllowance, type RunEngine } from "./allowance";

export type ResolvedRunEngine =
  | { ok: true; choice: "own"; engine: typeof RUN_ENGINE.OWN; allowance: null }
  | { ok: true; choice: "loki"; engine: RunEngine; allowance: BuildAllowance }
  | { ok: false; choice: "loki"; engine: null; allowance: BuildAllowance; message: string };

/**
 * The engine this account's NEXT build runs on. "own" (the default) is the
 * person's sign-in or a key marked for building: nothing to count, nothing
 * to refuse. "loki" is Loki's key within the welcome builds and the plan's
 * monthly builds; past them the dispatch is refused with the way forward in
 * the message, and the box stops writing Loki's key into the tenant's unit
 * (scripts/write-tenant-engines.ts). One reader for the dispatch gate, the
 * settings screen and the box.
 */
export async function resolveRunEngine(userId: string, now = new Date()): Promise<ResolvedRunEngine> {
  const user = await getUserById(userId);
  if (!user || user.buildEngine !== "loki")
    return { ok: true, choice: "own", engine: RUN_ENGINE.OWN, allowance: null };
  const [welcomeUsed, planUsedThisMonth, welcomeSpendUsdThisMonthValue] = await Promise.all([
    countRunsOnEngine(userId, RUN_ENGINE.LOKI_WELCOME),
    countRunsOnEngine(userId, RUN_ENGINE.LOKI_PLAN, monthStart(now)),
    welcomeSpendUsdThisMonth(now),
  ]);
  const allowance = buildAllowance({
    account: {
      plan: user.plan,
      planStatus: user.planStatus ?? null,
      planExpiresAt: user.planExpiresAt ?? null,
    },
    welcomeUsed,
    planUsedThisMonth,
    welcomeSpendUsdThisMonth: welcomeSpendUsdThisMonthValue,
    now,
  });
  if (allowance.engine) return { ok: true, choice: "loki", engine: allowance.engine, allowance };
  return { ok: false, choice: "loki", engine: null, allowance, message: allowance.reason! };
}
