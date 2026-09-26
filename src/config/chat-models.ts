/**
 * SSOT for the CHAT model chain — the models that drive Loki's tool loop.
 *
 * The chain LOGIC now lives in `@bitbaum/ai-kit`, extracted after the lesson was paid
 * for twice in this repo: four pinned free models rotted out from under the
 * vision half, and the chat half was still pinned to one vendor whose only
 * degradation was a step-down to a smaller model AT THE SAME VENDOR — drawing on
 * the same org-wide daily budget, so when the day's tokens ran out every link in
 * that "fallback" was already dead. A chain across VENDORS is what buys headroom,
 * because each vendor meters its own free tier independently.
 *
 * What stays here is the wiring: Loki's env prefix (`LOKI_*`, unchanged, so
 * the box needs no new variables) and the call signatures its callers already
 * use. What left is everything that was never Loki-specific.
 *
 * ── Before pinning a model here, PROBE IT ────────────────────────────────────
 * A model that cannot emit a parseable tool call cannot drive the loop, and that
 * is not guessable from its name, size, or docs. `npm run probe:models` calls
 * every link with a real tool and reports which protocol (if any) it answered
 * on. Of the nine free models probed for this chain, FIVE answered only via the
 * TEXT protocol — a native-only loop would have silently lost most of them,
 * which is why `llm.ts` always parses both. The upstream `freeChain()` carries
 * that probe table and the two models excluded on evidence.
 */

import {
  freeChain,
  providerModels as providerModelsOf,
  dayCapacityTokens as capacityOf,
  usableChain,
  chainFrom as chainFromLinks,
  isOwnKeyLink,
  type Provider,
  type Link,
} from "@bitbaum/ai-kit";

export type ChatProvider = Provider;
export type ChatLink = Link;

/**
 * The chain, strongest-first: Groq (fastest, loop verified on it) then
 * OpenRouter as a DIFFERENT vendor with a DIFFERENT daily budget.
 *
 * `freeChain("LOKI")` derives the override names this box already sets —
 * LOKI_GROQ_MODELS / LOKI_GROQ_DAILY_TOKENS and the OpenRouter pair — so a
 * rotted model is still routed around by an env change, without a deploy.
 */
export const CHAT_CHAIN: ChatProvider[] = freeChain("LOKI");

/** This provider's models, honouring its env override (read at call time). */
export function providerModels(provider: ChatProvider): string[] {
  return providerModelsOf(provider);
}

/** The day's total budget across every provider we hold a key for. */
export function dayCapacityTokens(): number {
  return capacityOf(CHAT_CHAIN);
}

/** The chain with unusable entries removed: no API key, or no models. */
export function usableChatChain(): ChatLink[] {
  return usableChain(CHAT_CHAIN);
}

/**
 * The chain starting at `model`, or the whole chain when it names no link.
 *
 * The default argument is load-bearing for callers like `llm.ts`, which pass
 * only a model. `LOKI_MODEL` is honoured as a STARTING POINT rather than a hard
 * pin: an operator pinning a model should still get a fallback when that model's
 * vendor runs dry, or the pin quietly restores the single point of failure this
 * chain exists to remove.
 */
export function chainFrom(model: string | undefined, chain = usableChatChain()): ChatLink[] {
  return chainFromLinks(model, chain);
}

/**
 * ── Prompt budgets, PER LINK ─────────────────────────────────────────────────
 *
 * How many tokens one call may carry, decided by the vendor that will serve it.
 *
 * The loop used to size every prompt against a single constant derived from
 * Groq's per-minute window (12000 × 0.8 / 3 rounds = 3200 tokens per call).
 * Two things were wrong with that at once. Groq cut the window to 8000, so the
 * constant was stale; and the constant was applied to EVERY vendor, so a
 * prompt that OpenRouter's free models (128k–1M context) would have taken
 * whole was shed to fit a Groq window it was never going to be sent to. The
 * system prompt alone is ~1300 tokens and the native tool schema ~1000, so on
 * the stale constant the fixed overhead exceeded the whole budget and every
 * production turn shipped ZERO facts — "[loki] round 1: 40 facts exceed the
 * call budget — sending 0" — and the model truthfully answered "Not in your
 * data." about records the database held.
 *
 * The rule now: a prompt is sized against the LARGEST usable link, and the
 * chain walker skips any link whose budget the prompt exceeds (a preflight,
 * not a failure — the same move Cat makes with its Groq overflow check). Groq
 * still serves the small turns it is fastest at; the big ones go straight to
 * the vendor with room instead of being starved to fit the one without.
 *
 * Groq meters per MODEL, so each Groq link has its own minute window and a
 * turn's second round can land on a sibling model with a fresh window.
 */

/** Groq free-tier tokens-per-minute per model. Observed 8000 on every current model (2026-09-11). */
const GROQ_TPM_DEFAULT = 8000;
/**
 * Cap for vendors with large contexts. Not the context length: past this the
 * turn is slow, expensive against the daily pool, and a small model answers
 * about the wrong record. 24k tokens is roughly 90 rendered facts, far past
 * the loop's fact cap.
 */
const LARGE_CONTEXT_PROMPT_TOKENS = 24_000;
/** Reply reserve — the completion is charged against the same window. */
const REPLY_RESERVE_TOKENS = 1400;
/** Headroom for the char/4 estimator's slop. */
const HEADROOM = 0.85;

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Held to Groq's FREE-tier minute window. A reader's own Groq key is not: its
 * limits are whatever their account has (paid tiers run far past 8000/min),
 * and sizing their prompts to Loki's free pool only cut the context of the
 * person who brought the stronger key.
 */
function onGroqFreeTier(link: ChatLink): boolean {
  return link.provider.id === "groq" && !isOwnKeyLink(link);
}

/** Tokens one PROMPT may carry on this link (the reply reserve already deducted). */
export function linkPromptBudgetTokens(link: ChatLink): number {
  if (onGroqFreeTier(link)) {
    const tpm = envInt("LOKI_GROQ_TPM", GROQ_TPM_DEFAULT);
    return Math.max(0, Math.floor(tpm * HEADROOM) - REPLY_RESERVE_TOKENS);
  }
  return envInt("LOKI_PROMPT_TOKENS_MAX", LARGE_CONTEXT_PROMPT_TOKENS);
}

/**
 * The largest prompt worth OFFERING this link — the bound the chain walker
 * skips against. Deliberately looser than the sizing budget above.
 *
 * Sizing and skipping look like the same question and are not, because the two
 * mistakes cost wildly different amounts:
 *
 *   Size a prompt too big  → it is truncated, or the only link refuses it and
 *                            the turn has nothing to fall back on. Unrecoverable,
 *                            so sizing keeps the estimator headroom.
 *   SKIP a link that would → measured on production: the turn goes to
 *   have taken the prompt    OpenRouter instead, 19-25 s, and spends one of only
 *                            50 free requests a day. That pool hit zero mid-eval
 *                            and the next question returned a 503.
 *   TRY a link that will   → Groq answers 429 in about a second and the chain
 *   refuse it                moves on to that same OpenRouter call. A per-minute
 *                            refusal is rejected before processing, so it costs
 *                            nothing against the daily token pool either.
 *
 * One second against twenty-five and a scarce request. A gate with that payoff
 * belongs at the hard limit, not below it — the 429 IS the safety net, which is
 * why the estimator's 15% is not also charged here. It was, and it was charged
 * against the reply reserve as well, a fixed allowance with no estimator error
 * in it: floor(8000 * 0.85) - 1400 = 5400 where the honest bound is 6600.
 */
export function linkPromptCeilingTokens(link: ChatLink): number {
  if (onGroqFreeTier(link)) {
    const tpm = envInt("LOKI_GROQ_TPM", GROQ_TPM_DEFAULT);
    return Math.max(0, tpm - REPLY_RESERVE_TOKENS);
  }
  return linkPromptBudgetTokens(link);
}

/** The largest prompt any usable link will take — what the loop sizes against. */
export function maxPromptBudgetTokens(chain = usableChatChain()): number {
  return chain.reduce((max, link) => Math.max(max, linkPromptBudgetTokens(link)), 0);
}
