/**
 * How many tokens the free pool really holds today — from what the vendors
 * said, not only from the figures written into the chain.
 *
 * The chain carries one `dailyTokens` per vendor (ai-kit `freeChain`): Groq
 * 100k, Google 50k, OpenRouter 100k. Those were set cautiously, before any
 * vendor had been heard from, and they are what the fair share divides. On
 * 2026-10-17 the platform keys served 357,184 tokens by the evening against a
 * configured 250,000 — Google alone 96,206 of its "50,000" — while the share
 * screen was telling people the pool was nearly gone. A pool drawn smaller
 * than it is rations people for nothing, and on a free plan that is the one
 * failure that costs money: it sends them away.
 *
 * Three witnesses, each a floor, never a guess:
 *
 * 1. A daily TOKEN ceiling the vendor stated (Groq's 429 prose: "Limit
 *    200000, Used 199773"). Vendors that meter per model — Groq does — give
 *    each model its own pool, so the chain's models are summed.
 * 2. A daily REQUEST ceiling (x-ratelimit-limit-requests: 1000). Counted once
 *    per vendor, as though the whole account shared it — OpenRouter's free
 *    allowance is account-wide — and turned into tokens at what a call costs
 *    on that vendor today. Where a token ceiling is also known, the smaller
 *    one binds.
 * 3. What the vendor already SERVED today. It cannot hold less than it gave.
 *
 * The request ceiling is the one that can read high: Groq publishes requests
 * per day in headers but states its tighter per-day TOKEN pool only in the
 * 429 that enforces it. That error corrects itself — the refusal is recorded
 * (lib/ai/record-quota.ts), the token ceiling then binds, and the figure falls
 * within one cache period (lib/ai/free-capacity.ts) — and the chain walks to
 * the next vendor meanwhile. An undercount has no such loop: nothing ever
 * tells a pool drawn too small that it was.
 *
 * A ceiling is a fact about the account, not about this minute, so a reading
 * from an earlier day still counts here even where the quota view calls its
 * REMAINING figure stale.
 *
 * The configured figure stays the floor — and an operator's explicit
 * `LOKI_<VENDOR>_DAILY_TOKENS` is a decision, so it wins outright.
 *
 * Pure: readings and the chain in, the day's capacity out.
 */

export type CeilingReading = {
  provider: string;
  model: string;
  scope: string;
  window: string;
  quotaLimit: number | null;
  source: string;
};

export type CapacityProvider = {
  id: string;
  models: string[];
  /** The chain's figure (or the operator's override). */
  configured: number;
  /** True when an operator set LOKI_<VENDOR>_DAILY_TOKENS: their figure is the answer. */
  overridden: boolean;
};

export type ProviderCapacity = {
  provider: string;
  configured: number;
  tokens: number;
  /** Which witness set the figure, in words — for the operator's screen. */
  from: "configured" | "operator" | "token ceiling" | "request ceiling" | "served today";
};

/** What one call costs when a vendor has served too few today to measure it. */
export const DEFAULT_TOKENS_PER_CALL = 3_000;
const MEASURED_AFTER_CALLS = 5;

export function providerCapacity(
  p: CapacityProvider,
  readings: CeilingReading[],
  served: { tokens: number; calls: number } | null,
): ProviderCapacity {
  if (p.overridden) {
    return { provider: p.id, configured: p.configured, tokens: p.configured, from: "operator" };
  }
  const daily = readings.filter(
    (r) =>
      r.provider === p.id &&
      r.window === "day" &&
      r.source !== "preflight" &&
      r.quotaLimit !== null &&
      r.quotaLimit > 0,
  );

  // Per model: the first (freshest, as listQuota orders them) token ceiling.
  const tokenCeiling = new Map<string, number>();
  for (const r of daily) {
    if (r.scope === "tokens" && p.models.includes(r.model) && !tokenCeiling.has(r.model)) {
      tokenCeiling.set(r.model, r.quotaLimit!);
    }
  }
  const tokenSum = [...tokenCeiling.values()].reduce((a, b) => a + b, 0);

  const perCall =
    served && served.calls >= MEASURED_AFTER_CALLS
      ? served.tokens / served.calls
      : DEFAULT_TOKENS_PER_CALL;
  const requestCeiling = daily
    .filter((r) => r.scope === "requests")
    .reduce((max, r) => Math.max(max, r.quotaLimit!), 0);
  const requestTokens = Math.round(requestCeiling * perCall);

  const candidates: Array<[number, ProviderCapacity["from"]]> = [[p.configured, "configured"]];
  if (tokenSum > 0) {
    candidates.push(
      requestTokens > 0 && requestTokens < tokenSum
        ? [requestTokens, "request ceiling"]
        : [tokenSum, "token ceiling"],
    );
  } else if (requestTokens > 0) {
    candidates.push([requestTokens, "request ceiling"]);
  }
  if (served && served.tokens > 0) candidates.push([served.tokens, "served today"]);

  const [tokens, from] = candidates.reduce((best, c) => (c[0] > best[0] ? c : best));
  return { provider: p.id, configured: p.configured, tokens, from };
}

export function observedDayCapacity(
  providers: CapacityProvider[],
  readings: CeilingReading[],
  served: Array<{ provider: string; tokens: number; calls: number }>,
): { tokens: number; providers: ProviderCapacity[] } {
  const servedBy = new Map(served.map((s) => [s.provider, s]));
  const rows = providers.map((p) => providerCapacity(p, readings, servedBy.get(p.id) ?? null));
  return { tokens: rows.reduce((a, r) => a + r.tokens, 0), providers: rows };
}
