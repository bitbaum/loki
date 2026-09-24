import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  HTTP_TIMEOUT_LONG_MS,
  RATE_LIMIT_WINDOW_LONG_MS,
  RATE_LIMIT_WINDOW_SHORT_MS,
} from "@/lib/constants/time";
import { WIDGET_TOKEN_STATUS } from "@/lib/constants/statuses";
import { getWidgetTokenByToken } from "@/db/queries/widget-tokens";
import { loadFleetMap } from "@/lib/register/load-map";
import type { FleetMap } from "@/lib/register/map";
import { callTextDetailed } from "@/lib/groq";
import { stripReasoning } from "@/lib/agent/llm";
import { checkAiBudget, recordAiSpend } from "@/lib/ai-budget/gate";
import { appUrl } from "@/lib/email";
import {
  type ConciergeLink,
  conciergePrompt,
  conciergeSystemPrompt,
  fallbackAnswer,
  linksForReply,
  renderConciergeFacts,
  splitSpeakers,
  trimToLastSentence,
} from "@/lib/widget-chat/concierge";

/**
 * The widget's Chat mode (widget/surface-modes.ts): a plain chat in which the
 * Cat and Loki both live. A visitor asks; whichever of them the question
 * belongs to answers as itself (both, when both have something useful), from
 * the public fleet map, and sends them to the project that fits. The reply
 * arrives split by speaker (`messages`) so the widget can say who said what.
 *
 * Public and cross-origin for the same reasons as /api/widget/transcribe, and
 * guarded the same way: the fcw_* token must be active, the per-token origin
 * allowlist holds, and spend is rate-limited per IP and per token. On top of
 * that the turn is charged to the TOKEN OWNER's fair share of the free pool —
 * a visitor's question costs the person who chose to put the widget there, and
 * cannot drain everyone else's day.
 *
 * It never refuses to route. Budget spent or every vendor down, the visitor
 * still gets a keyword match over the same map (`fallbackAnswer`), because
 * someone who only wanted to be pointed somewhere should not be told to come
 * back tomorrow.
 *
 * Deliberately NOT askLoki(): that is the operator's own agent, with memory
 * and tools. A stranger gets the catalogue and nothing else.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

function corsError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: CORS_HEADERS });
}

export const WIDGET_CHAT_MAX_MESSAGE = 1000;
export const WIDGET_CHAT_MAX_HISTORY = 12;
/** A conversation, not a scrape: one person asking questions stays well under this. */
const RATE_PER_IP = 20;
const RATE_PER_TOKEN = 300;

const ChatBody = z.object({
  token: z.string().startsWith("fcw_").max(100),
  message: z.string().trim().min(1).max(WIDGET_CHAT_MAX_MESSAGE),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .max(WIDGET_CHAT_MAX_HISTORY)
    .optional(),
  url: z.string().max(1000).optional(),
  pageTitle: z.string().max(300).optional(),
});

/**
 * The map is a handful of queries plus a read of apps.conf; a conversation
 * asks for it on every turn. Five minutes is the same staleness the public
 * GET already advertises in its Cache-Control.
 */
const MAP_TTL_MS = 5 * 60 * 1000;
let cachedMap: { map: FleetMap; at: number } | null = null;
async function fleetMap(): Promise<FleetMap | null> {
  if (cachedMap && Date.now() - cachedMap.at < MAP_TTL_MS) return cachedMap.map;
  const map = await loadFleetMap();
  if (map) cachedMap = { map, at: Date.now() };
  return map ?? cachedMap?.map ?? null;
}

/** The keyword fallback in the same shape as a model answer: one unattributed message. */
function withMessages(answer: { reply: string; links: ConciergeLink[] }) {
  return { ok: true, ...answer, messages: [{ speaker: null, text: answer.reply }], degraded: true };
}

export function OPTIONS(req: NextRequest) {
  // Same reflection as ingest: host pages stamp their own headers onto every
  // fetch, and a hardcoded allowlist would fail their preflight.
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
    return corsError("Too many questions at once — try again in a few minutes", 429);
  }

  const parsed = ChatBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return corsError("Invalid question", 400);
  const data = parsed.data;

  // Authorize before spending anything.
  const token = await getWidgetTokenByToken(data.token);
  if (!token) return corsError("Unknown or revoked widget token", 403);
  if (token.status !== WIDGET_TOKEN_STATUS.ACTIVE) {
    return corsError("This assistant is paused for this site", 403);
  }
  const origin = req.headers.get("origin");
  if (token.origins?.length && (!origin || !token.origins.includes(origin))) {
    return corsError("Origin not allowed for this widget", 403);
  }
  if (!checkRateLimit(`widget-chat:token:${token.id}`, RATE_PER_TOKEN, RATE_LIMIT_WINDOW_LONG_MS)) {
    return corsError("This site's assistant is busy — try again later", 429);
  }

  const map = await fleetMap();
  if (!map) return corsError("The catalogue is unavailable right now", 503);
  const base = appUrl();

  const budget = await checkAiBudget(token.userId);
  if (!budget.allowed) {
    return NextResponse.json(withMessages(fallbackAnswer(data.message, map, base)), {
      headers: CORS_HEADERS,
    });
  }

  try {
    const answered = await callTextDetailed(conciergePrompt(data.history ?? [], data.message), {
      feature: "widget-chat",
      systemPrompt: conciergeSystemPrompt(renderConciergeFacts(map), {
        url: data.url,
        title: data.pageTitle,
      }),
      // Reasoning models spend hidden tokens from this budget before the first
      // visible word; 700 cut real answers mid-sentence in production.
      maxTokens: 1600,
      temperature: 0.3,
      timeoutMs: HTTP_TIMEOUT_LONG_MS,
    });
    void recordAiSpend(token.userId, answered.tokens);
    const reply = trimToLastSentence(stripReasoning(answered.text).trim());
    if (!reply) throw new Error("empty answer");
    return NextResponse.json(
      { ok: true, reply, messages: splitSpeakers(reply), links: linksForReply(reply, map, base) },
      { headers: CORS_HEADERS },
    );
  } catch (e) {
    console.warn(
      "[widget-chat] model unavailable, routing by keywords:",
      e instanceof Error ? e.message : e,
    );
    return NextResponse.json(withMessages(fallbackAnswer(data.message, map, base)), {
      headers: CORS_HEADERS,
    });
  }
}
