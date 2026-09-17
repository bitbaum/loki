import { jsonOk, jsonError } from "@/lib/api/route-helpers";
import { getSessionUserId } from "@/lib/session";
import { listQuota } from "@/db/queries/provider-quota";
import { usageByFeature, usageByProvider } from "@/db/queries/ai-usage";
import { usableChatChain } from "@/config/chat-models";
import { isGatewayConfigured } from "@/lib/openclaw-gateway";
import {
  bindingRows,
  describeQuota,
  unknownQuota,
  summarise,
  dedupeConsequences,
  type QuotaRowView,
} from "@/lib/ai/quota-view";

/**
 * What is left at each AI vendor, as something the operator can act on.
 *
 * Reads observations recorded from rate-limit headers on calls the app was
 * already making — never by polling a vendor's usage endpoint, which was
 * measured reporting an untouched allowance while the key was locked out of
 * free models.
 *
 * The chain is walked as well as the table, because a provider with a key but
 * no reading has to appear as UNKNOWN. Listing only what has been measured
 * would let the page read as the whole fleet while silently omitting the vendor
 * about to serve the next turn.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);

  const now = Date.now();
  const [rows, chain, spend, providerSpend] = await Promise.all([
    listQuota().catch(() => []),
    Promise.resolve(usableChatChain()),
    // What today went ON. A limit with no spend beside it tells the operator
    // how much room is left but never where the room went — which is the half
    // they can actually act on.
    usageByFeature().catch(() => []),
    // The SECOND witness. A vendor that publishes no rate-limit headers can
    // never appear in provider_quota, so headers alone cannot tell "never
    // called" from "called, says nothing".
    usageByProvider().catch(() => []),
  ]);
  const servedToday = new Map(providerSpend.map((r) => [r.provider, r]));

  // Chain order is fallback order, so "what serves this next" is simply the
  // following link — that is the consequence half of every row.
  const nextAfter = (provider: string): string | null => {
    const idx = chain.findIndex((l) => l.provider.id === provider);
    if (idx === -1) return null;
    for (let i = idx + 1; i < chain.length; i++) {
      const next = chain[i];
      if (next && next.provider.id !== provider) return next.provider.id;
    }
    return null;
  };

  // One row per counter comes out of the table; one row per MODEL goes to the
  // page, carrying whichever counter is actually blocking. See bindingRows.
  const measured: QuotaRowView[] = bindingRows(
    rows.map((r) =>
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
        { now, nextProvider: nextAfter(r.provider) },
      ),
    ),
  );

  // Every configured vendor we have heard nothing from. Stated, not omitted.
  const heardFrom = new Set(rows.map((r) => r.provider));
  const silent: QuotaRowView[] = [];
  for (const link of chain) {
    if (heardFrom.has(link.provider.id)) continue;
    if (silent.some((s) => s.provider === link.provider.id)) continue;
    // Gemini serves most of the traffic and publishes nothing, so the old copy
    // — "has not served an answer yet" — was false about the busiest vendor,
    // and would have stayed false forever however long anyone waited. Spend
    // knows better: it records the call even when the vendor discloses no limit.
    const served = servedToday.get(link.provider.id);
    silent.push(
      served
        ? unknownQuota(
            link.provider.id,
            `served ${served.calls.toLocaleString("en-US")} call${served.calls === 1 ? "" : "s"} ` +
              `today (${served.tokens.toLocaleString("en-US")} tokens) — this vendor publishes no ` +
              `limits, so there is nothing left to measure`,
            "working, but its headroom cannot be known until it refuses",
          )
        : unknownQuota(link.provider.id, "configured, but it has not served an answer yet"),
    );
  }

  // Ordered by CHAIN POSITION, not by when each was last heard from. Recency
  // order put the last link at the top of the page saying "this is the last
  // link", directly above the provider that actually precedes it — a fallback
  // list has one meaningful order and it is the order things are tried in.
  const chainRank = (provider: string) => {
    const i = chain.findIndex((l) => l.provider.id === provider);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const providers = [...measured, ...silent].sort(
    (a, b) => chainRank(a.provider) - chainRank(b.provider),
  );

  // The gateway is not in the ai-kit chain, has no rate-limit headers, and
  // served most of today's answers. Omitting it let the page report every
  // provider spent while Loki kept working — the omission, not the numbers,
  // was what made the page read as untrue.
  if (isGatewayConfigured()) {
    providers.push({
      provider: "openclaw gateway",
      model: "—",
      state: "unknown",
      answers: null,
      detail: "no rate-limit headers — this vendor discloses nothing to measure",
      refills: null,
      consequence: "the fallback that answers when every link above is unavailable",
      level: null,
      urgent: false,
    });
  }
  return jsonOk({
    summary: summarise(providers),
    // Said once per run of rows that share it — see dedupeConsequences.
    providers: dedupeConsequences(providers),
    // So the page can say WHY a vendor is absent from the chain entirely.
    configured: chain.map((l) => ({ provider: l.provider.id, model: l.model })),
    /**
     * Today's tokens by feature, heaviest first.
     *
     * EMPTY IS A REAL ANSWER and must not be drawn as "nothing was spent": the
     * ledger starts at the deploy that began recording, so an empty list means
     * "nothing recorded yet today", which is the same three-state problem the
     * quota rows already solve. The page says which it is.
     */
    spend,
    spendTotal: spend.reduce((n, r) => n + r.tokens, 0),
  });
}
