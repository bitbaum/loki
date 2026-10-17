import {
  readQuota,
  readingFromRefusal,
  readingFromRefusalBody,
  type QuotaReading,
  type QuotaScope,
} from "@bitbaum/ai-kit";
import type { ChatLink } from "@/config/chat-models";

/**
 * Persist what a vendor just disclosed about its own remaining allowance.
 *
 * Called from the model seam on every response, success or refusal. Three
 * properties, each deliberate:
 *
 * NEVER AWAITED. The operator is waiting on an answer, and a telemetry write
 * has no business adding latency to it — still less failing it. The promise is
 * deliberately floated.
 *
 * NEVER THROWS. Every path is caught. A dashboard that cannot be written is a
 * dashboard that is out of date, which is survivable; an exception here would
 * turn a good answer into a link failure and demote a working vendor off the
 * chain, which is not.
 *
 * IMPORTS THE DATABASE LAZILY. `@/db` throws at MODULE INIT with no connection
 * string, so a static import would drag the whole unit suite into needing a
 * database to test a parser that touches none.
 */
export function recordVendorQuota(headers: Headers, link: ChatLink, keyOwner?: string): void {
  let readings: QuotaReading[] = [];
  try {
    readings = readQuota(headers, link);
  } catch {
    return;
  }
  persist(readings, keyOwner);
}

/**
 * Record that a link was SKIPPED without being called, because the prompt was
 * larger than its per-call budget.
 *
 * This is not a measurement, and it must not read as one. "Never called" and
 * "called and empty" look identical on a dashboard and mean opposite things:
 * one vendor is healthy and unreachable, the other is exhausted. The first
 * version of the settings page reported Groq as "waiting to be measured" while
 * every single turn walked past it — four skips in six hours, at 8,312 and
 * 10,153 tokens against a 5,400 budget. That is not a wait, it is a permanent
 * exclusion with a cause the operator can act on.
 *
 * `remaining` is 0 only because the column is non-null; `source: "preflight"`
 * is what the reader keys on, and the note carries the reason.
 */
export function recordPreflightSkip(link: ChatLink, promptTokens: number, budget: number): void {
  persist([
    {
      provider: link.provider.id,
      model: link.model,
      scope: "requests",
      window: "unknown",
      limit: null,
      remaining: 0,
      resetAt: null,
      source: "preflight",
      observedAt: Date.now(),
      note:
        `skipped without being called: a ~${promptTokens.toLocaleString("en-US")}-token prompt ` +
        `exceeds this model's ${budget.toLocaleString("en-US")}-token budget`,
    },
  ]);
}

/**
 * Record what a REFUSAL disclosed — including the limit no header carries.
 *
 * Groq meters three things and publishes two. The per-minute token window and
 * the per-day request count arrive as headers, so `recordVendorQuota` already
 * has them; the per-day TOKEN pool is stated only in the prose of the 429 that
 * enforces it. On 2026-09-13 that gap put the capacity page in exactly the
 * position it was built to avoid: Groq drawn as healthy — 2,672 of 8,000 tokens
 * left this minute, 999 of 1,000 requests left today — while every call was
 * being refused, because a third counter the page could not see was at 227 of
 * 200,000 and the operator's questions were returning 503.
 *
 * Falls back to the plain refusal reading when the body names no numbers: that
 * still records the one fact any 429 carries, which is that this link is spent
 * right now. What it must never do is invent a figure — an invented outage is
 * the same failure as an invented allowance, and costs the operator a provider.
 */
export function recordRefusal(
  link: ChatLink,
  body: string,
  retryAfterSec: number | null,
  scope: QuotaScope = "requests",
  keyOwner?: string,
): void {
  const stated = readingFromRefusalBody(link, body, retryAfterSec);
  persist([stated ?? readingFromRefusal(link, retryAfterSec, scope)], keyOwner);
}

/**
 * Fire-and-forget, never throws, database imported lazily.
 *
 * `keyOwner` is the person whose own key answered; absent means the shared
 * platform keys. The two never share a row: a person's Groq account says
 * nothing about the pool, and the pool says nothing about their account.
 */
function persist(
  readings: Array<QuotaReading & { note?: string | null }>,
  keyOwner?: string,
): void {
  if (readings.length === 0) return;
  void import("@/db/queries/provider-quota")
    .then(({ recordQuotaReadings }) => recordQuotaReadings(readings, keyOwner))
    .catch(() => undefined);
}
