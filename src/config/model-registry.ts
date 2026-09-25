/**
 * SSOT for every model id this app can call.
 *
 * Why a registry rather than "grep for it": on 2026-08-18 Groq removed
 * `llama-3.3-70b-versatile` and Loki kept asking for it for eight days.
 * `npm run probe:models` already existed — the fleet's answer to the previous
 * FOUR pinned-model rots — but it probes the Loki CHAT chain and the vision
 * chain, and the id that died was `GROQ_FAST_MODEL`, which no probe covered.
 * A checker that does not enumerate its subjects cannot report the one it
 * never knew about; see the "gates cannot see absence" class.
 *
 * So the rule is: a model id is callable ONLY if it appears here. Everything
 * below is IMPORTED from the place that actually uses it — never retyped —
 * so a registry entry cannot drift from the constant it claims to describe.
 *
 * `npm run check:models` asserts every entry still exists at its provider. It
 * costs no tokens (one GET /models per provider), so unlike `probe:models` it
 * is cheap enough to run on a schedule.
 */

import { GROQ_FAST_MODEL, GROQ_WHISPER_MODEL } from "@/lib/groq";
import { VERIFIER_PANEL } from "@/lib/frontier/propose";

export type ModelProvider = "groq" | "openrouter";

export type RegisteredModel = {
  id: string;
  provider: ModelProvider;
  /** What breaks when this id stops existing — the text a failure report shows. */
  usedFor: string;
  /** Which endpoint this id is called on. The callability probe posts a minimal
   *  chat completion, so it must skip transcription ids — they would 400 for a
   *  reason that has nothing to do with the fault being looked for. */
  kind: "chat" | "transcribe";
};

/** Statically pinned ids. The Loki chat + vision chains are deliberately NOT
 *  here: they live in `@bitbaum/ai-kit`, are env-overridable at runtime, and already
 *  fall through to another vendor. These are the pins with NO fallback — the
 *  ones whose death is a hard outage. */
export const REGISTERED_MODELS: RegisteredModel[] = [
  {
    id: GROQ_FAST_MODEL,
    provider: "groq",
    kind: "chat",
    usedFor:
      "default for every direct callGroqText: frontier digest + proposal generator, " +
      "activity digests, calendar-event extraction, extract-proposal, hosted-runner " +
      "analyze, today/watch compose, Loki's degraded fallback",
  },
  {
    id: GROQ_WHISPER_MODEL,
    provider: "groq",
    kind: "transcribe",
    usedFor: "voice transcription (callGroqTranscribe) — the mic on every composer",
  },
  ...VERIFIER_PANEL.map((j) => ({
    id: j.model,
    provider: "groq" as const,
    kind: "chat" as const,
    usedFor:
      "frontier proposal judge panel — a dead judge abstains, and a fully abstaining panel fails closed silently",
  })),
];

/** Deduplicated ids for one provider — several features share a model. */
export function registeredIdsFor(provider: ModelProvider): string[] {
  return [...new Set(REGISTERED_MODELS.filter((m) => m.provider === provider).map((m) => m.id))];
}
