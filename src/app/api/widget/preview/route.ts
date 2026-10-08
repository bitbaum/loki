import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { HTTP_TIMEOUT_LONG_MS, RATE_LIMIT_WINDOW_SHORT_MS } from "@/lib/constants/time";
import { getFeedbackForTour } from "@/db/queries/site-feedback";
import { callTextDetailed } from "@/lib/groq";
import { stripReasoning } from "@/lib/agent/llm";
import { checkAiBudget, recordAiSpend } from "@/lib/ai-budget/gate";
import { verifyTourToken } from "@/lib/feedback/tour-token";
import {
  PREVIEW_ASK_MAX,
  parsePreviewOps,
  previewPrompt,
  previewSystemPrompt,
} from "@/lib/widget-preview/plan";
import { TOUR_OUTLINE_MAX } from "../../../../../widget/tour";

/**
 * "Show me" on a walkthrough's last card: the owner (or the reporter) says
 * what they would rather see, and Loki answers with edits the widget applies
 * to the live page in their browser only (widget/preview.ts). Nothing is
 * saved; "Build this" files the same words as a follow-up.
 *
 * Public + CORS like the rest of the widget API, answering only to a tour
 * ticket — never a viewer's: a shared link shows the change, it does not
 * spend the owner's AI on strangers' ideas. Charged to the owner's budget.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

const Body = z.object({
  t: z.string().min(10).max(300),
  ask: z.string().trim().min(3).max(PREVIEW_ASK_MAX),
  path: z.string().max(500).optional(),
  outline: z
    .array(
      z.object({
        i: z.number().int().min(0).max(TOUR_OUTLINE_MAX),
        tag: z.string().max(20),
        text: z.string().max(200),
        id: z.string().max(60).optional(),
      }),
    )
    .max(TOUR_OUTLINE_MAX),
});

function corsJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`widget-preview:ip:${ip}`, 12, RATE_LIMIT_WINDOW_SHORT_MS)) {
    return corsJson({ error: "Too many previews at once — try again in a few minutes" }, 429);
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return corsJson({ error: "Say a little more about what to show" }, 400);
  const data = parsed.data;

  const ticket = verifyTourToken(data.t);
  if (!ticket) return corsJson({ error: "This walkthrough link has expired" }, 403);
  if (ticket.audience === "viewer") return corsJson({ error: "Previews are for the owner" }, 403);
  if (!checkRateLimit(`widget-preview:fb:${ticket.feedbackId}`, 20, RATE_LIMIT_WINDOW_SHORT_MS)) {
    return corsJson({ error: "That's a lot of previews — give it a few minutes" }, 429);
  }
  const row = await getFeedbackForTour(ticket.feedbackId);
  if (!row) return corsJson({ error: "Feedback not found" }, 404);
  const f = row.feedback;

  const budget = await checkAiBudget(f.userId).catch(() => ({ allowed: false }));
  if (!budget.allowed) {
    return corsJson({
      ok: true,
      ops: [],
      summary:
        "Today's AI budget is used up, so I can't draw a preview right now. Send it and it will be built.",
    });
  }
  try {
    const answered = await callTextDetailed(
      previewPrompt({
        ask: data.ask,
        fixedFor: f.suggestion,
        outline: data.outline,
        path: data.path ?? null,
      }),
      {
        feature: "widget-preview",
        systemPrompt: previewSystemPrompt(),
        maxTokens: 2400,
        temperature: 0.3,
        timeoutMs: HTTP_TIMEOUT_LONG_MS,
      },
    );
    void recordAiSpend(f.userId, answered.tokens);
    const plan = parsePreviewOps(stripReasoning(answered.text), data.outline.length);
    return corsJson({ ok: true, ...plan });
  } catch (e) {
    console.warn("[widget-preview] model unavailable:", e instanceof Error ? e.message : e);
    return corsJson({
      ok: true,
      ops: [],
      summary: "I couldn't draw a preview just now. Send it and it will be built.",
    });
  }
}
