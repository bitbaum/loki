import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  HTTP_TIMEOUT_LONG_MS,
  RATE_LIMIT_WINDOW_LONG_MS,
  RATE_LIMIT_WINDOW_SHORT_MS,
} from "@/lib/constants/time";
import { getWidgetProjectBrief, getWidgetTokenByToken } from "@/db/queries/widget-tokens";
import { WIDGET_TOKEN_STATUS } from "@/lib/constants/statuses";
import { isWidgetOriginAllowed } from "@/lib/widget/origin";
import { callTextDetailed, GROQ_STRONG_MODEL } from "@/lib/groq";
import { stripReasoning } from "@/lib/agent/llm";
import { checkAiBudget, recordAiSpend } from "@/lib/ai-budget/gate";
import { parseWalkRead, WALK_READ_SYSTEM, walkReadPrompt } from "@/lib/feedback/walk-read-prompt";
import { WALK_READ_LIMITS } from "../../../../../widget/walk-read";
import { clampMoments } from "../../../../../widget/moments-contract";

/**
 * POST /api/widget/understand — Loki reads a spoken note before it is saved
 * (widget/walk-read.ts): the ask, whether it is a change or a question, and
 * what was said that was not meant for Loki.
 *
 * Guarded exactly like /api/widget/advise: an active fcw_* token, the
 * per-token origin allowlist, per-IP and per-token limits, and the widget
 * owner's AI budget. It answers `{ ok: true, read: null }` whenever it cannot
 * read — the card then shows the words as spoken, as it always did, so a
 * failed read is never a dead end.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

/** A spoken note is read once; a person records a few in a session. */
const RATE_PER_IP = 12;
const RATE_PER_TOKEN = 200;

const Body = z.object({
  token: z.string().startsWith("fcw_").max(100),
  note: z.string().trim().min(1).max(12_000),
  moments: z.unknown().optional(),
});

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: CORS_HEADERS });
const noRead = () => json({ ok: true, read: null });

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
  if (!checkRateLimit(`widget-understand:ip:${ip}`, RATE_PER_IP, RATE_LIMIT_WINDOW_SHORT_MS)) {
    return json({ error: "Too many notes at once — try again in a few minutes" }, 429);
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid note" }, 400);
  const data = parsed.data;

  const token = await getWidgetTokenByToken(data.token);
  if (!token) return json({ error: "Unknown or revoked widget token" }, 403);
  if (token.status !== WIDGET_TOKEN_STATUS.ACTIVE) {
    return json({ error: "Loki is paused for this site" }, 403);
  }
  const origin = req.headers.get("origin");
  if (!isWidgetOriginAllowed({ tokenOrigins: token.origins, origin, allowMissingOrigin: false })) {
    return json({ error: "Origin not allowed for this widget" }, 403);
  }
  if (
    !checkRateLimit(
      `widget-understand:token:${token.id}`,
      RATE_PER_TOKEN,
      RATE_LIMIT_WINDOW_LONG_MS,
    )
  ) {
    return noRead();
  }
  const budget = await checkAiBudget(token.userId);
  if (!budget.allowed) return noRead();

  try {
    const project = await getWidgetProjectBrief(token.projectId).catch(() => null);
    const answered = await callTextDetailed(
      walkReadPrompt({
        project: project?.name ?? null,
        note: data.note.slice(0, WALK_READ_LIMITS.note),
        moments: clampMoments(data.moments),
      }),
      {
        feature: "widget-understand",
        systemPrompt: WALK_READ_SYSTEM,
        // One call per spoken note, read by the person before anything is
        // built: the fast model copied "look at all these things" back
        // verbatim and missed the asides on the owner's own walk (2026-10-18).
        model: GROQ_STRONG_MODEL,
        reasoningEffort: "medium",
        maxTokens: 2000,
        temperature: 0.1,
        timeoutMs: HTTP_TIMEOUT_LONG_MS,
      },
    );
    void recordAiSpend(token.userId, answered.tokens);
    return json({ ok: true, read: parseWalkRead(stripReasoning(answered.text)) });
  } catch (e) {
    console.warn("[widget-understand] model unavailable:", e instanceof Error ? e.message : e);
    return noRead();
  }
}
