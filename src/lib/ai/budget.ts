import { dayCapacityTokens, usableChatChain } from "@/config/chat-models";
import { CUSTOM_VENDOR_ID, vendorById } from "@/config/model-vendors";
import { getDayUsage, getWeekSpend } from "@/db/queries/ai-spend";
import { ownUsageByVendor } from "@/db/queries/own-model-usage";
import { listQuota } from "@/db/queries/provider-quota";
import type { ProviderQuota } from "@/db/schema/provider-quota";
import { listOwnModels } from "@/db/queries/user-model-keys";
import { getUserPreferences } from "@/db/queries/user-preferences";
import { HISTORY_CHARS_PER_TURN, HISTORY_TURNS } from "@/lib/agent/loop";
import { userBudgetView, type BudgetView } from "@/lib/ai/budget-view";
import { effectiveTimeZone } from "@/lib/agent/now-line";
import { bindingRows, describeQuota, nextProviderAfter } from "@/lib/ai/quota-view";

/**
 * The person's budget, read from the four ledgers and rendered once.
 *
 * This is the only place the ledgers are joined for a user, so the Settings
 * card, the picker and the assistant's own answer all read the same view —
 * three surfaces that computed it separately would be three ways for the
 * numbers to disagree, and a budget screen that disagrees with the refusal is
 * worse than none.
 *
 * Every read is best-effort: a ledger that cannot be read degrades that part
 * of the view to "nothing recorded", never to an error. The gate admits a
 * turn when it cannot read the ledger, and the view that describes the gate
 * must not fail where the gate would not.
 */
export async function readUserBudget(userId: string, now = new Date()): Promise<BudgetView> {
  const chain = usableChatChain();
  const [usage, own, ownUsage, rows, ownRows, week, prefs] = await Promise.all([
    getDayUsage(userId, now).catch(() => ({ userSpentTokens: 0, userTurns: 0, activeUsers: 1 })),
    listOwnModels(userId).catch(() => []),
    ownUsageByVendor(userId, now).catch(() => []),
    listQuota(),
    // The person's own keys, metered by their vendor into rows of their own.
    listQuota(userId),
    getWeekSpend(userId, now).catch(() => undefined),
    getUserPreferences(userId).catch(() => null),
  ]);

  const describe = (r: ProviderQuota, nextProvider: string | null) =>
    describeQuota(
      {
        provider: r.provider,
        model: r.model,
        scope: r.scope,
        window: r.windowKind,
        quotaLimit: r.quotaLimit,
        remaining: r.remaining,
        resetAt: r.resetAt,
        observedAt: r.observedAt,
        source: r.source,
        note: r.note,
      },
      { now: now.getTime(), nextProvider },
    );
  const vendorRows = bindingRows(
    rows.map((r) => describe(r, nextProviderAfter(chain, r.provider))),
  );

  const usageByVendor = new Map(ownUsage.map((u) => [u.vendor, u]));
  return userBudgetView({
    now,
    dayCapacityTokens: dayCapacityTokens(),
    activeUsers: usage.activeUsers,
    userSpentTokens: usage.userSpentTokens,
    userTurns: usage.userTurns,
    chain: chain.map((l) => ({ provider: l.provider.id, model: l.model })),
    vendorRows,
    ...(week ? { week } : {}),
    memory: { turns: HISTORY_TURNS, charsPerTurn: HISTORY_CHARS_PER_TURN },
    ...(prefs ? { stance: prefs.modelStance } : {}),
    timeZone: effectiveTimeZone(prefs, now),
    ownKeys: own.map((m) => {
      const vendor = vendorById(m.vendor);
      const u = usageByVendor.get(m.vendor);
      return {
        vendor: m.vendor,
        label: m.vendor === CUSTOM_VENDOR_ID && m.label ? m.label : (vendor?.label ?? m.vendor),
        model: m.model,
        billingUrl: vendor?.billingUrl ?? null,
        limit: vendor?.limit ?? null,
        usage: u
          ? {
              tokensToday: u.tokensToday,
              callsToday: u.callsToday,
              tokens30d: u.tokens30d,
              calls30d: u.calls30d,
            }
          : null,
        quota: ownRows.filter((r) => r.provider === m.vendor).map((r) => describe(r, null)),
      };
    }),
  });
}
