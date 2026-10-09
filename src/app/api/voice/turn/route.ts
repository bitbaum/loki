/**
 * POST /api/voice/turn — one sentence from the microphone in, one sentence
 * for the headphones out. Thin: lib/voice/turn.ts owns the grammar and the
 * actions, every one of them a seam the screen already uses.
 */
import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { runVoiceTurn } from "@/lib/voice/turn";

const Body = z.object({
  text: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(12)
    .optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const result = await runVoiceTurn(userId, dataOrResp.text, dataOrResp.history);
  return NextResponse.json(result);
}
