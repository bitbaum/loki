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
import { freeDayCapacityTokens } from "@/lib/ai/free-capacity";
import { reachableLinks } from "@/lib/widget-chat/reachable";
import { recordVisitorSpend, visitorPoolAllows } from "@/lib/widget-chat/visitor-pool";
import { appUrl } from "@/lib/email";
import { getStudioCommission, type StudioCommissionContract } from "@/lib/studio-commission";
import {
  type ConciergeLink,
  conciergePrompt,
  conciergeSystemPrompt,
  fallbackAnswer,
  linksForReply,
  renderConciergeFacts,
  splitSpeakers,
} from "@/lib/widget-chat/concierge";
import { formatConciergeAnswer, visualAnswerInstruction } from "@/lib/widget-chat/answer-format";
import { isWidgetOriginAllowed } from "@/lib/widget/origin";
import { analyzeImages } from "@/lib/vision";
import {
  IntakeImages,
  VISITOR_VISION_SYSTEM,
  decideReady,
  fallbackIntakeReply,
  intakePrompt,
  intakeReplyProblem,
  intakeSystemPrompt,
  parseIntakeAnswer,
  pictureNote,
  splitDataUrl,
} from "@/lib/widget-chat/intake";

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
 * that every visitor turn draws from the visitors' own slice of the free pool
 * (lib/widget-chat/visitor-pool.ts) — never from the widget owner's personal
 * share, which an owner who also uses Loki had spent by midday, leaving every
 * stranger with the keyword fallback.
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
  visualAnswers: z.boolean().optional(),
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
  /** "intake": the studio's door on bitbaum.orangecat.ch (lib/widget-chat/intake.ts).
   *  Absent: the front desk that routes to a project. */
  mode: z.enum(["intake"]).optional(),
  purpose: z.enum(["studio", "partner"]).optional(),
  /** Pictures for this turn, as data URLs (jpeg/png/webp, ≤3, ≤600k chars each). */
  images: IntakeImages.optional(),
});

/**
 * What the visitor's pictures show, as text, or null when no vision model
 * could read them. Never throws: a picture that cannot be read is said so in
 * the answer, never silently dropped.
 */
async function readPictures(images: string[], question: string): Promise<string | null> {
  const parts = images.map(splitDataUrl).filter((p): p is NonNullable<typeof p> => p !== null);
  if (!parts.length) return null;
  try {
    const { text } = await analyzeImages({
      systemPrompt: VISITOR_VISION_SYSTEM,
      prompt: question.slice(0, 500) || "Describe what this picture shows.",
      images: parts,
      maxTokens: 400,
      timeoutMs: 30_000,
    });
    return text.trim() || null;
  } catch (e) {
    console.warn("[widget-chat] pictures unread:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Said under an answer whose pictures no model could read — in code, so it is never left to chance. */
const PICTURES_UNREAD =
  "I could not read the picture here. Tell me in words what it shows, or paste its text.";

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

/**
 * The studio's published contract (offer, availability, course), on the same
 * five-minute staleness as the map. A failed fetch keeps the last good copy;
 * none at all still answers, with the partner terms but no course detail.
 */
let cachedStudio: { studio: StudioCommissionContract | null; at: number } | null = null;
async function studioContract(): Promise<StudioCommissionContract | null> {
  if (cachedStudio && Date.now() - cachedStudio.at < MAP_TTL_MS) return cachedStudio.studio;
  const studio = (await getStudioCommission()) ?? cachedStudio?.studio ?? null;
  cachedStudio = { studio, at: Date.now() };
  return studio;
}

/**
 * The keyword fallback in the same shape as a model answer: one unattributed
 * message. `why` says which door closed — the visitors' pool or every model —
 * so a degraded answer seen live can be diagnosed without the server log.
 */
function withMessages(answer: { reply: string; links: ConciergeLink[] }, why: "budget" | "model") {
  return {
    ok: true,
    ...answer,
    messages: [{ speaker: null, text: answer.reply }],
    degraded: true,
    why,
  };
}

/** The keyword fallback, with the same check on its links as a model answer. */
async function keywordAnswer(
  message: string,
  map: FleetMap,
  base: string,
  why: "budget" | "model",
) {
  const answer = fallbackAnswer(message, map, base);
  return withMessages({ ...answer, links: await reachableLinks(answer.links, map, base) }, why);
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
  if (!isWidgetOriginAllowed({ tokenOrigins: token.origins, origin, allowMissingOrigin: false })) {
    return corsError("Origin not allowed for this widget", 403);
  }
  if (!checkRateLimit(`widget-chat:token:${token.id}`, RATE_PER_TOKEN, RATE_LIMIT_WINDOW_LONG_MS)) {
    return corsError("This site's assistant is busy — try again later", 429);
  }

  if (data.mode === "intake") return intakeTurn(data);

  const map = await fleetMap();
  if (!map) return corsError("The catalogue is unavailable right now", 503);
  const base = appUrl();

  if (!visitorPoolAllows(await freeDayCapacityTokens())) {
    return NextResponse.json(await keywordAnswer(data.message, map, base, "budget"), {
      headers: CORS_HEADERS,
    });
  }

  const images = data.images ?? [];
  const pictures = images.length ? await readPictures(images, data.message) : null;
  try {
    const answered = await callTextDetailed(
      conciergePrompt(data.history ?? [], data.message + pictureNote(pictures, images.length)),
      {
        feature: "widget-chat",
        systemPrompt:
          conciergeSystemPrompt(renderConciergeFacts(map, await studioContract()), {
            url: data.url,
            title: data.pageTitle,
          }) + visualAnswerInstruction(data.visualAnswers === true),
        // Reasoning models spend hidden tokens from this budget before the first
        // visible word; 700 cut real answers mid-sentence in production.
        maxTokens: 1600,
        temperature: 0.3,
        timeoutMs: HTTP_TIMEOUT_LONG_MS,
      },
    );
    recordVisitorSpend(answered.tokens);
    const reply = formatConciergeAnswer(stripReasoning(answered.text), data.visualAnswers === true);
    if (!reply) throw new Error("empty answer");
    const unread = images.length > 0 && !pictures;
    return NextResponse.json(
      {
        ok: true,
        reply,
        messages: [
          ...splitSpeakers(reply),
          ...(unread ? [{ speaker: null, text: PICTURES_UNREAD }] : []),
        ],
        ...(images.length ? { pictures: pictures ? "read" : "unread" } : {}),
        links: await reachableLinks(linksForReply(reply, map, base), map, base),
      },
      { headers: CORS_HEADERS },
    );
  } catch (e) {
    console.warn(
      "[widget-chat] model unavailable, routing by keywords:",
      e instanceof Error ? e.message : e,
    );
    return NextResponse.json(await keywordAnswer(data.message, map, base, "model"), {
      headers: CORS_HEADERS,
    });
  }
}

type ChatInput = z.infer<typeof ChatBody>;

/**
 * One turn of the studio intake. Never a refusal: budget spent, every model
 * down, or an answer that broke a rule (a price not published, a date, a
 * booking, past work) — the visitor still gets an honest question that moves
 * the brief, and `ready` is decided here, in code.
 */
async function intakeTurn(data: ChatInput): Promise<NextResponse> {
  const purpose = data.purpose ?? "studio";
  const history = data.history ?? [];
  const visitorTurns = history.filter((t) => t.role === "user").length + 1;
  const images = data.images ?? [];
  const reply = (body: {
    text: string;
    modelReady: boolean;
    summary: string;
    degraded?: string;
    pictures?: string | null;
  }) => {
    const unread = images.length > 0 && !body.pictures;
    return NextResponse.json(
      {
        ok: true,
        reply: body.text,
        messages: [
          { speaker: "loki", text: body.text },
          ...(unread ? [{ speaker: "loki", text: PICTURES_UNREAD }] : []),
        ],
        ready: decideReady({
          modelReady: body.modelReady,
          visitorTurns,
          message: data.message,
          summary: body.summary,
        }),
        summary: body.summary,
        ...(images.length ? { pictures: body.pictures ? "read" : "unread" } : {}),
        ...(body.degraded ? { degraded: true, why: body.degraded } : {}),
      },
      { headers: CORS_HEADERS },
    );
  };
  const fallback = (why: string, pictures: string | null = null) =>
    reply({
      text: fallbackIntakeReply(purpose, visitorTurns),
      modelReady: false,
      summary: "",
      degraded: why,
      pictures,
    });

  if (!visitorPoolAllows(await freeDayCapacityTokens())) return fallback("budget");
  const pictures = images.length ? await readPictures(images, data.message) : null;
  const studio = await studioContract();
  try {
    const answered = await callTextDetailed(
      intakePrompt(history, data.message, pictureNote(pictures, images.length)),
      {
        feature: "widget-chat",
        systemPrompt: intakeSystemPrompt(studio, purpose, { url: data.url, title: data.pageTitle }),
        maxTokens: 1600,
        temperature: 0.3,
        timeoutMs: HTTP_TIMEOUT_LONG_MS,
      },
    );
    recordVisitorSpend(answered.tokens);
    const parsed = parseIntakeAnswer(stripReasoning(answered.text));
    if (!parsed) return fallback("shape", pictures);
    const problem = intakeReplyProblem(parsed.reply, studio);
    if (problem) {
      console.warn(`[widget-chat] intake answer withheld (${problem})`);
      return fallback(problem, pictures);
    }
    return reply({
      text: parsed.reply,
      modelReady: parsed.ready,
      summary: parsed.summary,
      pictures,
    });
  } catch (e) {
    console.warn("[widget-chat] intake model unavailable:", e instanceof Error ? e.message : e);
    return fallback("model", pictures);
  }
}
