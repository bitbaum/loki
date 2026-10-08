import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  HTTP_TIMEOUT_LONG_MS,
  RATE_LIMIT_WINDOW_LONG_MS,
  RATE_LIMIT_WINDOW_SHORT_MS,
} from "@/lib/constants/time";
import { WIDGET_TOKEN_STATUS } from "@/lib/constants/statuses";
import { getWidgetProjectBrief, getWidgetTokenByToken } from "@/db/queries/widget-tokens";
import { callTextDetailed } from "@/lib/groq";
import { stripReasoning } from "@/lib/agent/llm";
import { checkAiBudget, recordAiSpend } from "@/lib/ai-budget/gate";
import { trimToLastSentence } from "@/lib/widget-chat/concierge";
import {
  ADVISE_MAX_HISTORY,
  ADVISE_MAX_QUESTION,
  ADVISE_MAX_SESSION,
  ADVISE_MAX_SNAPSHOT,
  ADVISE_UNAVAILABLE,
  advisePrompt,
  adviseSystemPrompt,
  plainAnswer,
  splitAdvice,
} from "@/lib/widget-advise/advisor";

/**
 * The widget's Ask mode (widget/advise.ts): "is this right, should it change,
 * how would you make the site better?" — answered about the page the person is
 * looking at, from an outline their own browser built.
 *
 * Guarded exactly like /api/widget/chat: active fcw_* token, the per-token
 * origin allowlist, per-IP and per-token rate limits, and every turn charged to
 * the TOKEN OWNER's AI budget — the builder chose to put the widget there.
 *
 * It never dead-ends. Budget spent or every vendor down, the answer says so
 * and the widget offers to send the question to the builder instead.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

/** A review is heavier than a front-desk question, so fewer per visitor. */
const RATE_PER_IP = 12;
const RATE_PER_TOKEN = 200;

const AdviseBody = z.object({
  token: z.string().startsWith("fcw_").max(100),
  question: z.string().trim().min(1).max(ADVISE_MAX_QUESTION),
  scope: z.enum(["element", "page", "site"]),
  snapshot: z.string().max(ADVISE_MAX_SNAPSHOT),
  /** Watch's session record (the pill's Review) — makes the answer a review
   *  of what the owner did, not only of the page. */
  session: z.string().max(ADVISE_MAX_SESSION).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(3000) }))
    .max(ADVISE_MAX_HISTORY)
    .optional(),
});

function corsJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

const unavailable = () =>
  corsJson({ ok: true, reply: ADVISE_UNAVAILABLE, changes: [], degraded: true });

export function OPTIONS(req: NextRequest) {
  // Host pages stamp their own headers onto every fetch; reflect them.
  const requested = req.headers.get("access-control-request-headers");
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      ...(requested ? { "Access-Control-Allow-Headers": requested } : {}),
    },
  });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`widget-advise:ip:${ip}`, RATE_PER_IP, RATE_LIMIT_WINDOW_SHORT_MS)) {
    return corsJson({ error: "Too many questions at once — try again in a few minutes" }, 429);
  }
  const parsed = AdviseBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return corsJson({ error: "Invalid question" }, 400);
  const data = parsed.data;

  const token = await getWidgetTokenByToken(data.token);
  if (!token) return corsJson({ error: "Unknown or revoked widget token" }, 403);
  if (token.status !== WIDGET_TOKEN_STATUS.ACTIVE) {
    return corsJson({ error: "Loki is paused for this site" }, 403);
  }
  const origin = req.headers.get("origin");
  if (token.origins?.length && (!origin || !token.origins.includes(origin))) {
    return corsJson({ error: "Origin not allowed for this widget" }, 403);
  }
  if (
    !checkRateLimit(`widget-advise:token:${token.id}`, RATE_PER_TOKEN, RATE_LIMIT_WINDOW_LONG_MS)
  ) {
    return corsJson({ error: "Loki is busy on this site — try again later" }, 429);
  }

  const budget = await checkAiBudget(token.userId);
  if (!budget.allowed) return unavailable();

  try {
    const project = await getWidgetProjectBrief(token.projectId).catch(() => null);
    const answered = await callTextDetailed(advisePrompt(data.history ?? [], data.question), {
      feature: "widget-advise",
      systemPrompt: adviseSystemPrompt({
        scope: data.scope,
        snapshot: data.snapshot,
        project,
        session: data.session,
      }),
      // Reasoning models spend hidden tokens before the first visible word; a
      // session review answers through five lenses and needs the room.
      maxTokens: data.session ? 2600 : 1800,
      temperature: 0.3,
      timeoutMs: HTTP_TIMEOUT_LONG_MS,
    });
    void recordAiSpend(token.userId, answered.tokens);
    const { answer, changes } = splitAdvice(stripReasoning(answered.text));
    const reply = plainAnswer(trimToLastSentence(answer));
    if (!reply) throw new Error("empty answer");
    return corsJson({ ok: true, reply, changes });
  } catch (e) {
    console.warn("[widget-advise] model unavailable:", e instanceof Error ? e.message : e);
    return unavailable();
  }
}
