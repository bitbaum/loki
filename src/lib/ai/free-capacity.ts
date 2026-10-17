import { CHAT_CHAIN, dayCapacityTokens, providerModels } from "@/config/chat-models";
import {
  observedDayCapacity,
  type CapacityProvider,
  type ProviderCapacity,
} from "@/lib/ai/observed-capacity";

/**
 * The free pool's size today, as the gate, the budget screen and the visitor
 * chat all divide it (lib/ai/observed-capacity.ts says how it is read).
 *
 * Cached for a few minutes: the gate asks on every turn, and the figure moves
 * only when a vendor states a new ceiling or serves more. Fails to the
 * configured figure — the gate fails open on a ledger error, and the number it
 * divides must not be the one thing that can still throw.
 *
 * The database is imported lazily, like the gate's ledger: `@/db` throws at
 * module init without a connection string, and the gate's tests have none.
 */
type FreeCapacity = { tokens: number; providers: ProviderCapacity[] };

const TTL_MS = 5 * 60_000;
let cached: { at: number; value: FreeCapacity } | null = null;

/** The keyed vendors of the free chain, each with its configured figure. */
function keyedProviders(env = process.env): CapacityProvider[] {
  return CHAT_CHAIN.filter((p) => !p.byok && env[p.keyEnv]?.trim()).map((p) => {
    const override = p.dailyTokensEnv ? env[p.dailyTokensEnv]?.trim() : undefined;
    const n = override === undefined ? Number.NaN : Number(override);
    const overridden = Number.isFinite(n) && n >= 0;
    return {
      id: p.id,
      models: providerModels(p),
      configured: overridden ? n : p.dailyTokens,
      overridden,
    };
  });
}

async function freeDayCapacity(now = Date.now()): Promise<FreeCapacity> {
  if (cached && now - cached.at < TTL_MS) return cached.value;
  try {
    const [{ listQuota }, { usageByProvider }] = await Promise.all([
      import("@/db/queries/provider-quota"),
      import("@/db/queries/ai-usage"),
    ]);
    const [rows, served] = await Promise.all([
      listQuota(),
      usageByProvider(new Date(now)).catch(() => []),
    ]);
    const value = observedDayCapacity(
      keyedProviders(),
      rows.map((r) => ({
        provider: r.provider,
        model: r.model,
        scope: r.scope,
        window: r.windowKind,
        quotaLimit: r.quotaLimit,
        source: r.source,
      })),
      served,
    );
    cached = { at: now, value };
    return value;
  } catch {
    return { tokens: dayCapacityTokens(), providers: [] };
  }
}

export async function freeDayCapacityTokens(): Promise<number> {
  return (await freeDayCapacity()).tokens;
}
