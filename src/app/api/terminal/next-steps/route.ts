import { NextRequest, NextResponse } from "next/server";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { callGroqText, GROQ_STRONG_MODEL } from "@/lib/groq";
import {
  buildNextStepsPrompt,
  NEXT_STEPS_INPUT_CHARS,
  nextStepsSystemPrompt,
  parseNextSteps,
} from "@/lib/terminal-next-steps";
import { findAdapter } from "@/lib/agents";

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
  /** The agent in the session, by adapter id; its label is looked up here so
   *  no free text reaches the system prompt. */
  agent: z.string().trim().max(40).nullish(),
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
        systemPrompt: nextStepsSystemPrompt(findAdapter(body.agent)?.label ?? null),
        // The larger model: judging what the agent is waiting on is the whole
        // job, and the small one answered "Yes, go ahead." to a request for
        // data (2026-10-15). It reasons, so it gets room to before it answers.
        model: GROQ_STRONG_MODEL,
        maxTokens: 700,
        temperature: 0.3,
        timeoutMs: 12_000,
      },
    );
    return jsonOk({ steps: parseNextSteps(raw) });
  } catch {
    return jsonOk({ steps: [] });
  }
}
