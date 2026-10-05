import { NextRequest, NextResponse } from "next/server";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { callGroqText, GROQ_FAST_MODEL } from "@/lib/groq";
import {
  buildNextStepsPrompt,
  NEXT_STEPS_INPUT_CHARS,
  NEXT_STEPS_SYSTEM_PROMPT,
  parseNextSteps,
} from "@/lib/terminal-next-steps";

/**
 * POST /api/terminal/next-steps — up to three instructions to send a session
 * next, from its screen or its last reply. Optional by nature: a slow or
 * failed model answers `steps: []` with 200, and the rule-based chips stay.
 */
const Body = z.object({
  context: z
    .string()
    .trim()
    .min(1)
    .max(NEXT_STEPS_INPUT_CHARS * 2),
  source: z.enum(["screen", "reply"]),
  project: z.string().trim().max(200).nullish(),
});

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);

  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;

  try {
    const raw = await callGroqText(
      buildNextStepsPrompt(body.context, body.source, body.project ?? null),
      {
        feature: "terminal-next-steps",
        systemPrompt: NEXT_STEPS_SYSTEM_PROMPT,
        model: GROQ_FAST_MODEL,
        maxTokens: 160,
        temperature: 0.4,
        timeoutMs: 8_000,
      },
    );
    return jsonOk({ steps: parseNextSteps(raw) });
  } catch {
    return jsonOk({ steps: [] });
  }
}
