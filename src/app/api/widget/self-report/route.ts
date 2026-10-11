import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_SHORT_MS, RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import { FEEDBACK_SOURCE, WIDGET_TOKEN_STATUS } from "@/lib/constants/statuses";
import { getWidgetTokenByToken } from "@/db/queries/widget-tokens";
import {
  bumpDuplicateFeedback,
  bumpDuplicateFeedbackByNotice,
  insertSiteFeedback,
} from "@/db/queries/site-feedback";
import { feedbackContentHash } from "@/lib/feedback/content-hash";
import { notifyFeedbackReceived } from "@/lib/feedback/notify-new";
import { verifyOwnerPass } from "@/lib/feedback/owner-pass";
import { isWidgetOriginAllowed } from "@/lib/widget/origin";
import {
  buildSelfReport,
  selfReportNeedsOwner,
  WIDGET_SELF_DETAIL_MAX,
  WIDGET_SELF_KINDS,
  WIDGET_SELF_NOTE_MAX,
  WIDGET_SELF_PAGE,
} from "@/lib/widget/self-report";

/**
 * POST /api/widget/self-report — the widget filing something about ITSELF
 * into Loki's own project (lib/widget/self-report.ts says why).
 *
 * Same public, cross-origin shape as api/feedback: the HOST's fcw_ token and
 * its origin allowlist prove a real install sent it; the row goes to the
 * project FEEDBACK_WIDGET_TOKEN belongs to, never to the host's. What the
 * widget noticed on its own needs the owner pass; a note a person wrote does
 * not. Screenshots ride with a note under the ingest's own caps.
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

const Body = z.object({
  token: z.string().startsWith("fcw_").max(100),
  kind: z.enum(WIDGET_SELF_KINDS),
  detail: z.string().max(WIDGET_SELF_DETAIL_MAX).optional(),
  note: z.string().trim().max(WIDGET_SELF_NOTE_MAX).optional(),
  url: z.string().max(1000).optional(),
  viewport: z.string().max(20).optional(),
  ownerPass: z.string().max(300).optional(),
  screenshots: z
    .array(
      z
        .string()
        .regex(/^data:image\/(jpeg|png|webp);base64,/)
        .max(600_000),
    )
    .max(5)
    .optional(),
});

export function OPTIONS(req: NextRequest) {
  // Reflect requested headers, as api/feedback does: host pages stamp their
  // own headers onto every fetch, and a fixed list fails their preflight.
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
  if (!checkRateLimit(`widget-self:ip:${ip}`, 10, RATE_LIMIT_WINDOW_SHORT_MS)) {
    return corsError("Too many reports, try again later", 429);
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return corsError("Invalid report", 400);
  const data = parsed.data;
  if (data.kind === "note" && !data.note) return corsError("Say what should be better", 400);

  const host = await getWidgetTokenByToken(data.token);
  if (!host || host.status !== WIDGET_TOKEN_STATUS.ACTIVE) {
    return corsError("Unknown or paused widget", 403);
  }
  const origin = req.headers.get("origin");
  if (!isWidgetOriginAllowed({ tokenOrigins: host.origins, origin, allowMissingOrigin: false })) {
    return corsError("Origin not allowed for this widget", 403);
  }
  if (selfReportNeedsOwner(data.kind)) {
    const pass = data.ownerPass ? verifyOwnerPass(data.ownerPass) : null;
    if (!pass || pass.projectId !== host.projectId || pass.userId !== host.userId) {
      return corsError("Only the site's owner's widget reports on its own", 403);
    }
  }
  // Per install: one broken page cannot fill Loki's inbox from many IPs.
  if (!checkRateLimit(`widget-self:token:${host.id}`, 60, RATE_LIMIT_WINDOW_LONG_MS)) {
    return corsError("Too many reports, try again later", 429);
  }

  const raw = process.env.FEEDBACK_WIDGET_TOKEN?.trim();
  const loki = raw ? await getWidgetTokenByToken(raw) : null;
  if (!loki || loki.status !== WIDGET_TOKEN_STATUS.ACTIVE) {
    return corsError("Loki's own feedback is not set up here, so this could not be filed.", 503);
  }

  const report = buildSelfReport({
    kind: data.kind,
    detail: data.detail,
    note: data.note,
    url: data.url ?? origin,
    viewport: data.viewport,
  });
  const contentHash = feedbackContentHash(report.suggestion, WIDGET_SELF_PAGE);
  const bumped =
    (report.noticeKey
      ? await bumpDuplicateFeedbackByNotice(loki.projectId, report.noticeKey)
      : null) ?? (await bumpDuplicateFeedback(loki.projectId, contentHash));
  if (bumped) {
    return NextResponse.json({ ok: true, duplicateOf: bumped }, { headers: CORS_HEADERS });
  }

  const created = await insertSiteFeedback({
    projectId: loki.projectId,
    userId: loki.userId,
    tokenId: loki.id,
    suggestion: report.suggestion,
    page: WIDGET_SELF_PAGE,
    url: data.url ?? null,
    pageTitle: report.pageTitle,
    scope: "site",
    // Found by the widget itself is a machine's finding, like the AI reviewer's;
    // a note is a person's.
    source: data.kind === "note" ? FEEDBACK_SOURCE.VISITOR : FEEDBACK_SOURCE.AI_REVIEW,
    contentHash,
    noticeKey: report.noticeKey,
    screenshots: data.kind === "note" ? (data.screenshots ?? null) : null,
    userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
  });
  if (!created) return corsError("Could not store the report, try again later", 500);
  void notifyFeedbackReceived(created);
  return NextResponse.json({ ok: true, id: created.id }, { headers: CORS_HEADERS });
}
