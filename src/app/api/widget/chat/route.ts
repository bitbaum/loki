import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  HTTP_TIMEOUT_LONG_MS,
  RATE_LIMIT_WINDOW_LONG_MS,
  RATE_LIMIT_WINDOW_SHORT_MS,
} from "@/lib/constants/time";
import { getWidgetProjectName, getWidgetTokenByToken } from "@/db/queries/widget-tokens";
import { callTextDetailed } from "@/lib/groq";
import { WIDGET_AGENT_PERSONAS, WIDGET_AGENT_SERVER_IDS } from "@/config/widget-agents";

/**
 * Chat for the embeddable widget — a visitor on a customer's site talks to
 * Loki (development agent) or Cat (economic agent). Streams plain text.
 *
 * Same trust model as /api/widget/transcribe: the write-only fcw_* token
 * authorizes it, the per-token origin allowlist is enforced against Origin,
 * and spend is capped per IP and per token so one hostile page cannot drain
 * the model budget. Stateless on purpose: the widget sends the transcript each
 * turn and nothing is stored — a visitor who wants something built hands the
 * conversation over through /api/feedback, which is the durable record.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

// Mirrors CHAT_MAX_TURNS / CHAT_MAX_TURN_CHARS in widget/agents.ts.
const Body = z.object({
  token: z.string().startsWith("fcw_").max(100),
  agent: z.enum(WIDGET_AGENT_SERVER_IDS),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(16),
  url: z.string().max(1000).optional(),
  pageTitle: z.string().max(300).optional(),
});

/** Per visitor IP — a conversation, not a script. */
const RATE_PER_IP = 20;
/** Per project token over the long window. */
const RATE_PER_TOKEN = 400;

function corsError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: CORS_HEADERS });
}

export function OPTIONS(req: NextRequest) {
  // Reflect requested headers: customer sites wrap window.fetch and stamp
  // their own headers on every request (see /api/widget/transcribe).
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
  if (!checkRateLimit(`widget-chat:ip:${ip}`, RATE_PER_IP, RATE_LIMIT_WINDOW_SHORT_MS)) {
    return corsError("Slow down a little — try again in a minute", 429);
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return corsError("Invalid chat message", 400);
  const body = parsed.data;
  if (body.messages[body.messages.length - 1]!.role !== "user") {
    return corsError("The last message must be the visitor's", 400);
  }

  // Authorize before spending: the token read is cheap, the model call is not.
  const token = await getWidgetTokenByToken(body.token);
  if (!token) return corsError("Unknown or revoked widget token", 403);
  const origin = req.headers.get("origin");
  if (token.origins?.length && (!origin || !token.origins.includes(origin))) {
    return corsError("Origin not allowed for this widget", 403);
  }
  if (!checkRateLimit(`widget-chat:token:${token.id}`, RATE_PER_TOKEN, RATE_LIMIT_WINDOW_LONG_MS)) {
    return corsError("This site has used its chat allowance, try again later", 429);
  }

  const projectName =
    (await getWidgetProjectName(token.projectId).catch(() => null)) ?? "this site";
  const systemPrompt = WIDGET_AGENT_PERSONAS[body.agent]({
    projectName,
    pageTitle: body.pageTitle,
    pageUrl: body.url,
  });
  // The text chain takes one prompt, so the transcript travels as one.
  const turns = body.messages;
  const history = turns
    .slice(0, -1)
    .map((t) => `${t.role === "user" ? "Visitor" : "You"}: ${t.content}`)
    .join("\n\n");
  const prompt = `${history ? `Conversation so far:\n\n${history}\n\n---\n\n` : ""}Visitor: ${turns[turns.length - 1]!.content}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // A link can die after emitting; the next one starts over. \u0000 tells
      // the widget to discard what it has shown for this turn.
      const sink = {
        delta: (text: string) => controller.enqueue(encoder.encode(text)),
        reset: () => controller.enqueue(encoder.encode("\u0000")),
      };
      try {
        await callTextDetailed(prompt, {
          feature: `widget-chat:${body.agent}`,
          systemPrompt,
          sink,
          maxTokens: 700,
          temperature: 0.4,
          timeoutMs: HTTP_TIMEOUT_LONG_MS,
        });
      } catch {
        // Provider internals never reach a stranger's page.
        controller.enqueue(encoder.encode("\u0000\u0001"));
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
