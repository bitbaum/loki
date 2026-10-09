/**
 * The studio voice: text → WAV through Groq's Orpheus endpoint, the same
 * account and quota ledger as transcription. Server-only (the key). The
 * phone decides what to do when this is unavailable — it falls back to its
 * own voice — so this throws plainly rather than guessing.
 */
import { GROQ_BASE_URL } from "@/lib/groq";
import { recordVendorQuota } from "@/lib/ai/record-quota";
import { HTTP_TIMEOUT_LONG_MS } from "@/lib/constants/time";
import { NO_SCREEN_TTS_MODEL, NO_SCREEN_VOICES, type NoScreenVoice } from "@/config/no-screen";

const SPEECH_URL = `${GROQ_BASE_URL}/audio/speech`;

export const SERVER_VOICES = NO_SCREEN_VOICES.map((v) => v.id).filter(
  (id) => id !== "phone",
) as Exclude<NoScreenVoice, "phone">[];

export function isSpeechConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

export async function synthesizeSpeech(
  text: string,
  voice: Exclude<NoScreenVoice, "phone">,
): Promise<ArrayBuffer> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");
  const res = await fetch(SPEECH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: NO_SCREEN_TTS_MODEL,
      voice,
      input: text,
      response_format: "wav",
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_LONG_MS),
  });
  recordVendorQuota(res.headers, {
    provider: {
      id: "groq",
      baseUrl: GROQ_BASE_URL,
      keyEnv: "GROQ_API_KEY",
      models: [NO_SCREEN_TTS_MODEL],
      dailyTokens: 0,
    },
    model: NO_SCREEN_TTS_MODEL,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`groq speech ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.arrayBuffer();
}
