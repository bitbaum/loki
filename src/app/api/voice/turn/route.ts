/**
 * POST /api/voice/turn — one sentence from the microphone in, one sentence
 * for the headphones out. Thin: lib/voice/turn.ts owns the grammar and the
 * actions, every one of them a seam the screen already uses.
 *
 * `mode` is the page's own state (which voice, which switches, whether the
 * studio voice is off), handed to a question so Loki can answer one about
 * the screen truthfully. Optional: a caller without a screen sends none.
 */
import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { runVoiceTurn } from "@/lib/voice/turn";
import { NO_SCREEN_VOICES } from "@/config/no-screen";

const Body = z.object({
  text: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(12)
    .optional(),
  mode: z
    .object({
      voice: z.enum(NO_SCREEN_VOICES.map((v) => v.id) as [string, ...string[]]),
      music: z.boolean(),
      bargeIn: z.boolean(),
      mode: z.enum(["everything", "important"]),
      studioOff: z.string().max(400).nullable().optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const { text, history, mode } = dataOrResp;
  const result = await runVoiceTurn(
    userId,
    text,
    history,
    mode ? { ...mode, voice: mode.voice as (typeof NO_SCREEN_VOICES)[number]["id"] } : null,
  );
  return NextResponse.json(result);
}
