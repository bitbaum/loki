import { NextRequest, NextResponse } from "next/server";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { callGroqText, GROQ_FAST_MODEL } from "@/lib/groq";
import {
  buildFollowUpPrompt,
  FOLLOW_UP_SYSTEM_PROMPT,
  parseFollowUps,
} from "@/lib/loki/follow-ups";

/**
 * POST /api/loki/follow-ups — three suggested next questions for the exchange
 * the client just finished showing. Optional by nature: a slow or failed model
 * answers `suggestions: []` with 200, and the chat simply shows none.
 */
const Body = z.object({
  question: z.string().trim().min(1).max(20_000),
  answer: z.string().trim().min(1).max(40_000),
});

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);

  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  try {
    const raw = await callGroqText(buildFollowUpPrompt(dataOrResp.question, dataOrResp.answer), {
      feature: "chat-follow-ups",
      systemPrompt: FOLLOW_UP_SYSTEM_PROMPT,
      model: GROQ_FAST_MODEL,
      maxTokens: 200,
      temperature: 0.7,
      timeoutMs: 8_000,
    });
    return jsonOk({ suggestions: parseFollowUps(raw) });
  } catch {
    return jsonOk({ suggestions: [] });
  }
}
