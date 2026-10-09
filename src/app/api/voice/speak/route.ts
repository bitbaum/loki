/**
 * POST /api/voice/speak — one short piece of text as WAV, in a studio
 * voice. The phone cuts a briefing into pieces (lib/voice/speak-chunks) and
 * fetches them one ahead of the one playing. 503 when no voice is
 * configured on this box: the phone then reads with its own voice, and the
 * person hears the same words a little less well.
 */
import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { isSpeechConfigured, SERVER_VOICES, synthesizeSpeech } from "@/lib/voice/tts";

const Body = z.object({
  text: z.string().trim().min(1).max(600),
  voice: z.enum(SERVER_VOICES as [string, ...string[]]),
});

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSpeechConfigured())
    return NextResponse.json({ error: "No studio voice is configured here." }, { status: 503 });

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
    const message = err instanceof Error ? err.message : "speech failed";
    console.error("[voice/speak]", message);
    return NextResponse.json({ error: "The studio voice did not answer." }, { status: 502 });
  }
}
