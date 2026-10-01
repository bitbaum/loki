import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_SHORT_MS, RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import { getWidgetTokenByToken } from "@/db/queries/widget-tokens";
import { WIDGET_TOKEN_STATUS } from "@/lib/constants/statuses";
import { transcribeWithGroq } from "@/lib/transcribe";

/**
 * Speech-to-text for the embeddable feedback widget — the visitor speaks
 * instead of typing, and the transcript lands in the same textarea they can
 * then edit before sending.
 *
 * Why this is a separate route from /api/beacon/transcribe, rather than that
 * one gaining CORS headers:
 *
 *   • The beacon route takes NO token. It is matcher-excluded so the operator's
 *     own mic works, and is guarded only by a per-IP limiter. Making it
 *     readable cross-origin would turn it into an anonymous endpoint that
 *     spends our Groq quota for anyone who finds the URL.
 *   • This route authenticates with the same write-only fcw_* widget token that
 *     already authorizes ingest, and enforces the same per-token origin
 *     allowlist. Spend is therefore always attributable to a project whose
 *     owner chose to enable a widget.
 *   • Groq only, no local-Whisper fallback: the fallback spawns ffmpeg +
 *     python3 on the host, which is a CPU-exhaustion vector when the caller is
 *     anonymous. Operators keep the fallback on the beacon route.
 *
 * ACAO is `*` for the same reason as ingest: the token grants a narrow
 * capability, no cookies are involved, and the origin allowlist is enforced
 * server-side against the Origin header rather than by CORS.
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

/** ~2 minutes of Opus. A feedback note is seconds long; this is head-room, not a target. */
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
/** Per visitor IP. Speaking a report takes longer than this allows to abuse. */
const RATE_PER_IP = 10;
/** Per project token, over the long window — one hostile page cannot drain the
 *  quota from many IPs without tripping this. */
const RATE_PER_TOKEN = 100;

export function OPTIONS(req: NextRequest) {
  // Same reflection as ingest: customer sites monkey-patch window.fetch and
  // stamp their own headers onto every request, including this multipart POST.
  // A hardcoded allowlist fails their preflight and silently kills the mic.
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
  if (!checkRateLimit(`widget-transcribe:ip:${ip}`, RATE_PER_IP, RATE_LIMIT_WINDOW_SHORT_MS)) {
    return corsError("Too many recordings, try again in a minute", 429);
  }

  const form = await req.formData().catch(() => null);
  if (!form) return corsError("Invalid upload", 400);

  const tokenValue = form.get("token");
  if (typeof tokenValue !== "string" || !tokenValue.startsWith("fcw_") || tokenValue.length > 100) {
    return corsError("Missing or malformed widget token", 400);
  }

  const audio = form.get("audio");
  if (!(audio instanceof File)) return corsError("No audio", 400);
  if (audio.size > MAX_AUDIO_BYTES) return corsError("Recording too long (max ~2 minutes)", 413);

  // Authorize BEFORE spending anything: the token lookup is a cheap indexed
  // read, transcription is a paid network call.
  const token = await getWidgetTokenByToken(tokenValue);
  if (!token) return corsError("Unknown or revoked widget token", 403);
  if (token.status !== WIDGET_TOKEN_STATUS.ACTIVE) {
    return corsError("This assistant is paused for this site", 403);
  }

  const origin = req.headers.get("origin");
  if (token.origins?.length && (!origin || !token.origins.includes(origin))) {
    return corsError("Origin not allowed for this widget", 403);
  }

  if (
    !checkRateLimit(
      `widget-transcribe:token:${token.id}`,
      RATE_PER_TOKEN,
      RATE_LIMIT_WINDOW_LONG_MS,
    )
  ) {
    return corsError("This site has used its transcription allowance, try again later", 429);
  }

  const result = await transcribeWithGroq(audio);
  if (result.ok) {
    return NextResponse.json({ text: result.text }, { headers: CORS_HEADERS });
  }
  // `detail` is deliberately not returned: it can carry provider internals, and
  // this response is readable by any visitor on a customer's site.
  return corsError(result.error, result.status);
}
