import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_SHORT_MS } from "@/lib/constants/time";
import { WIDGET_TOKEN_STATUS } from "@/lib/constants/statuses";
import { getWidgetTokenByToken, touchWidgetToken } from "@/db/queries/widget-tokens";
import { normalizeWidgetPlacement, type WidgetPlacement } from "@/config/widget-placement";
import { PALETTE } from "@/lib/palette";
import { ORANGECAT_CAPABILITIES, SOLON_PROPOSE_URL } from "@/config/ecosystem";

/**
 * Widget boot: the embed's first call on every page load. Returns whether the
 * widget should render at all — which makes the token row the remote kill
 * switch (pause/revoke takes effect on the customer site in seconds, no
 * deploy). Doubles as the heartbeat behind the setup UI's "Live ✓": lastSeenAt
 * is observed truth, never install intent.
 *
 * Public + CORS like /api/feedback (excluded from proxy.ts). Reflects
 * requested headers in preflight for the same reason as ingest: customer
 * fetch wrappers stamp arbitrary headers. Response carries no PII — just the
 * render verdict.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
  // Pause propagates within this window; page loads stay cheap. Vary:Origin
  // because the verdict depends on the allowlist check against Origin.
  "Cache-Control": "public, max-age=30",
  Vary: "Origin",
} as const;

/**
 * `placement` rides along with the render verdict rather than getting its own
 * call: the widget already blocks on this response before drawing anything, so
 * folding position in costs no extra round trip and removes any window where
 * the launcher paints in one corner and then jumps to another.
 *
 * Theme colors also travel with boot so the widget never hardcodes hex values.
 * Colors come from PALETTE.widget, generated from @bitbaum/design-tokens.
 *
 * Omitted entirely when the widget will not render — a paused token should
 * leak nothing about the project's configuration.
 */
function bootResponse(active: boolean, status = 200, placement?: WidgetPlacement): NextResponse {
  return NextResponse.json(
    active && placement
      ? {
          active,
          placement,
          theme: PALETTE.widget,
          // Where each chat agent hands off: Cat to the visitor's own Cat,
          // Solon to a pre-filled proposal. Loki's action is local (ingest).
          chat: {
            handoffs: { cat: ORANGECAT_CAPABILITIES.catUrl, solon: SOLON_PROPOSE_URL },
          },
        }
      : { active },
    {
      status,
      headers: CORS_HEADERS,
    },
  );
}

export function OPTIONS(req: NextRequest) {
  const requested = req.headers.get("access-control-request-headers");
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Allow-Headers": requested ?? "Content-Type",
    },
  });
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`widget-boot:ip:${ip}`, 60, RATE_LIMIT_WINDOW_SHORT_MS)) {
    return bootResponse(false, 429);
  }

  const token = req.nextUrl.searchParams.get("token");
  if (!token?.startsWith("fcw_") || token.length > 100) return bootResponse(false);

  const row = await getWidgetTokenByToken(token);
  if (!row || row.status !== WIDGET_TOKEN_STATUS.ACTIVE) return bootResponse(false);

  // A widget on a non-allowlisted origin can't submit anyway (ingest 403s) —
  // don't render a dead FAB there. No Origin header (same-origin dogfood,
  // curl) passes, matching ingest semantics.
  const origin = req.headers.get("origin");
  if (row.origins?.length && origin && !row.origins.includes(origin)) {
    return bootResponse(false);
  }

  // Fire-and-forget heartbeat (throttled to 1/min in the query) — the render
  // verdict must not wait on the write.
  void touchWidgetToken(row.id, origin).catch(() => {});

  // normalize, never validate-and-reject: a malformed or half-migrated row must
  // still render a widget at the default position rather than none at all.
  return bootResponse(true, 200, normalizeWidgetPlacement(row.placement));
}
