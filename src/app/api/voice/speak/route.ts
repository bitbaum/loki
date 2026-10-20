/**
 * POST /api/voice/speak — one short piece of text as WAV, in a studio
 * voice. The phone cuts a briefing into pieces (lib/voice/speak-chunks) and
 * fetches them one ahead of the one playing.
 *
 * When there is no audio to give, the answer says WHY as a TtsFailure
 * (lib/voice/tts-failure: a reason, one sentence, and the link that fixes
 * it): 503 when no voice is configured here, 502 when Groq refused. The
 * phone then reads with its own voice AND says so on screen, and the same
 * reason goes to the debug log, so System shows it too.
 */
import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { logDebug } from "@/db/queries/debug-logs";
import { isSpeechConfigured, SERVER_VOICES, synthesizeSpeech, TtsError } from "@/lib/voice/tts";
import { ttsFailure, type TtsFailure } from "@/lib/voice/tts-failure";

const Body = z.object({
  text: z.string().trim().min(1).max(600),
  voice: z.enum(SERVER_VOICES as [string, ...string[]]),
});

/** One debug row per reason per this long: the phone retries every two
 *  minutes while a voice is refused, and System is not a log of retries. */
const LOG_EVERY_MS = 30 * 60_000;
const lastLogged = new Map<string, number>();

function record(failure: TtsFailure, detail: string) {
  const now = Date.now();
  if (now - (lastLogged.get(failure.reason) ?? 0) < LOG_EVERY_MS) return;
  lastLogged.set(failure.reason, now);
  void logDebug({
    source: "voice/speak",
    level: failure.reason === "no-key" ? "warn" : "error",
    message: `Studio voice off: ${failure.explain}${failure.fix ? ` ${failure.fix.steps} ${failure.fix.url}` : ""}`,
    meta: { reason: failure.reason, detail },
  });
}

function refused(failure: TtsFailure, status: number) {
  return NextResponse.json({ error: failure.explain, ...failure }, { status });
}

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSpeechConfigured()) {
    const failure = ttsFailure("no-key");
    record(failure, "GROQ_API_KEY not set");
    return refused(failure, 503);
  }

  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  try {
    const wav = await synthesizeSpeech(
      dataOrResp.text,
      dataOrResp.voice as (typeof SERVER_VOICES)[number],
    );
    return new NextResponse(wav, {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const failure = err instanceof TtsError ? err.failure : ttsFailure("unknown");
    const detail = err instanceof TtsError ? err.detail : String(err);
    console.error("[voice/speak]", failure.reason, detail);
    record(failure, detail);
    return refused(failure, 502);
  }
}
