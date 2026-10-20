/**
 * Why the studio voice did not speak, in the owner's words, with the one
 * place to fix it.
 *
 * Until this existed a refused request to Groq's speech endpoint was a 502
 * whose reason went only to the server's console, and the phone fell back to
 * its own voice in silence — so every voice in the picker sounded the same and
 * nothing on the screen said why (owner on /voice, 2026-10-20: "Troy sounds
 * the same as Diana as anyone else"). The usual cause is not a bug at all:
 * Groq gates the Orpheus voices behind terms an org admin accepts once.
 *
 * Pure (no network, no server imports), so the page can render a failure the
 * route sent and scripts/test/voice-tts-failure.ts pins the classifier.
 */
import { NO_SCREEN_TTS_MODEL } from "@/config/no-screen";

export type TtsFailureReason =
  | "terms"
  | "no-key"
  | "bad-key"
  | "limit"
  | "model-gone"
  | "vendor-down"
  | "unreachable"
  | "unknown";

export type TtsFailure = {
  reason: TtsFailureReason;
  /** One plain sentence: what is wrong, said to the owner. */
  explain: string;
  /** Where the owner fixes it, when there is such a place. */
  fix?: { url: string; label: string; steps: string };
};

/** Groq's own page for the voice model; the terms are accepted there. */
export const GROQ_VOICE_TERMS_URL = `https://console.groq.com/playground?model=${NO_SCREEN_TTS_MODEL}`;
const GROQ_KEYS_URL = "https://console.groq.com/keys";
const GROQ_LIMITS_URL = "https://console.groq.com/settings/limits";
const GROQ_STATUS_URL = "https://groqstatus.com";

const FAILURES: Record<TtsFailureReason, Omit<TtsFailure, "reason">> = {
  terms: {
    explain: "Groq needs its voice terms accepted once before it will speak.",
    fix: {
      url: GROQ_VOICE_TERMS_URL,
      label: "Open Groq's voice page",
      steps: "Sign in to Groq as the account's admin, open its voice page and press Accept.",
    },
  },
  "no-key": {
    explain: "This server has no Groq key to speak with.",
  },
  "bad-key": {
    explain: "Groq turned down the server's key: it is wrong, expired or was deleted.",
    fix: {
      url: GROQ_KEYS_URL,
      label: "Open Groq's keys",
      steps: "Make a new key there and put it in the server's GROQ_API_KEY.",
    },
  },
  limit: {
    explain: "Groq's limit for spoken words is used up for now.",
    fix: {
      url: GROQ_LIMITS_URL,
      label: "See Groq's limits",
      steps: "It resets by itself; a paid plan raises it.",
    },
  },
  "model-gone": {
    explain: "Groq no longer offers the voice model Loki asks for.",
  },
  "vendor-down": {
    explain: "Groq's voice service is having trouble right now.",
    fix: { url: GROQ_STATUS_URL, label: "Groq's status page", steps: "It usually comes back." },
  },
  unreachable: {
    explain: "The studio voice could not be reached from this phone.",
  },
  unknown: {
    explain: "Groq refused to read the text, and did not say why in a way Loki knows.",
  },
};

export function ttsFailure(reason: TtsFailureReason): TtsFailure {
  return { reason, ...FAILURES[reason] };
}

/** The `error.code` / `error.message` Groq puts in an OpenAI-shaped body. */
function readGroqError(body: string): { code: string; message: string } {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } | string };
    const e = parsed.error;
    if (typeof e === "string") return { code: "", message: e };
    return {
      code: typeof e?.code === "string" ? e.code : "",
      message: typeof e?.message === "string" ? e.message : "",
    };
  } catch {
    return { code: "", message: body };
  }
}

/**
 * Groq's answer → the reason. The error CODE decides first, because Groq
 * answers the terms gate with a plain 400 that would otherwise read as
 * "refused"; the status decides only when the body says nothing we know.
 */
export function classifyTtsFailure(status: number, body: string): TtsFailure {
  const { code, message } = readGroqError(body);
  const text = `${code} ${message}`.toLowerCase();
  if (code === "model_terms_required" || /\bterms\b/.test(text)) return ttsFailure("terms");
  if (code === "invalid_api_key" || status === 401) return ttsFailure("bad-key");
  if (code === "rate_limit_exceeded" || status === 429) return ttsFailure("limit");
  if (
    code === "model_not_found" ||
    code === "model_decommissioned" ||
    status === 404 ||
    /decommissioned|does not exist|not found/.test(text)
  )
    return ttsFailure("model-gone");
  if (status === 403) return ttsFailure("bad-key");
  if (status >= 500) return ttsFailure("vendor-down");
  return ttsFailure("unknown");
}

const REASONS = new Set<string>(Object.keys(FAILURES));

/**
 * What /api/voice/speak answered when it was not audio, read on the phone.
 * Anything that is not a failure the route wrote (a proxy's HTML page, a
 * dropped connection) is "unreachable" — still a sentence, never a blank.
 */
export function readTtsFailure(json: unknown): TtsFailure {
  const reason = (json as { reason?: unknown } | null)?.reason;
  return typeof reason === "string" && REASONS.has(reason)
    ? ttsFailure(reason as TtsFailureReason)
    : ttsFailure("unreachable");
}

/** The line the page shows (and says once): what is off, why, and what it means. */
export function studioVoiceOffSentence(f: TtsFailure): string {
  return `Studio voices are off: ${lowerFirst(f.explain)} Until then Loki reads with your phone's voice, so every voice sounds the same.`;
}

function lowerFirst(s: string): string {
  // "Groq …" keeps its capital; a sentence that starts with a plain word drops it.
  return /^(Groq|Loki)\b/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
}
