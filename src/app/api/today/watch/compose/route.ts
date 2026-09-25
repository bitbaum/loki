import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/session";
import { callGroqText } from "@/lib/groq";
import { checkRateLimit } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";

/** Per user per hour. Only a click reaches this (LokiNudge), so a real person
 *  stays far below it; it caps a stuck client or a script on the free tier. */
const COMPOSE_PER_HOUR = 20;

// Keep the prose tight — this lands inside a Watch card, not a long-form
// reply. Two sentences max, no preamble, no hedging.
const SYSTEM_PROMPT = `You are Loki, the user's AI agent.

Compose one short paragraph (one or two sentences max) that names the focus item the user should pay attention to right now and proposes one small concrete next move.

Voice: direct, warm, not preachy. Speak to the user like a sharp friend who pays attention to their life.

Constraints:
- No preamble ("Hey," / "OK so" / "It looks like"). Start with the substance.
- No second-guessing or hedging ("you might want to...", "maybe consider..."). Recommend the move.
- No questions back to the user. The user wants a read, not a quiz.
- Use the data given. Do not invent details. If the data is sparse, lean on what's there.
- Two sentences absolute maximum.`;

const requestSchema = z.object({
  kind: z.enum([
    "overdue-commitment",
    "overdue-goal",
    "habit-at-risk",
    "imminent-bill",
    "imminent-event",
    "stale-contact",
    "stalled-goal",
  ]),
  title: z.string().min(1).max(500),
  context: z.string().min(1).max(500),
});

/**
 * POST /api/today/watch/compose
 *
 * Turn a templated Watch focus (kind + title + context) into a Loki-composed
 * one-paragraph nudge. Called by the TodayWatch client component once the
 * page is interactive — the server-rendered Watch card shows the templated
 * context as immediate signal, then upgrades to composed prose when the LLM
 * call returns.
 *
 * Cheap by design: tight system prompt, two-sentence cap, GROQ_FAST_MODEL,
 * 8s timeout. If Groq is unavailable or rate-limited, we return a 503 and
 * the client keeps the template prose — no harm done.
 */
export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkRateLimit(`today-watch:${userId}`, COMPOSE_PER_HOUR, RATE_LIMIT_WINDOW_LONG_MS)) {
    return NextResponse.json({ error: "Too many requests — try again later" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { kind, title, context } = parsed.data;
  const prompt = [
    `Focus kind: ${kind.replaceAll("-", " ")}`,
    `Focus title: ${title}`,
    `Context: ${context}`,
    "",
    "Compose the one-paragraph nudge now. No preamble. No questions back.",
  ].join("\n");

  try {
    const composed = await callGroqText(prompt, {
      feature: "today-watch",
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 120,
      temperature: 0.3,
      timeoutMs: 8_000,
    });
    if (!composed) {
      return NextResponse.json({ error: "Empty composition" }, { status: 503 });
    }
    return NextResponse.json({ composed });
  } catch (err) {
    // Groq missing key, rate-limited, or timed out — client keeps the
    // template prose. Don't 500; this is an enhancement, not core path.
    const message = err instanceof Error ? err.message : "compose failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
