import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_SHORT_MS } from "@/lib/constants/time";
import { FEEDBACK_SOURCE, FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { getWidgetProjectKey } from "@/db/queries/widget-tokens";
import { listProjectFeedback } from "@/db/queries/site-feedback";
import { getUserTheme } from "@/db/queries/user-preferences";
import { DEFAULT_THEME_MODE } from "@/config/theme";
import { attachFeedbackWork } from "@/lib/feedback/attach-work";
import { livePageHref } from "@/lib/feedback/fix-shipping";
import { createTourToken, tourSiteUrl, watchFixPath } from "@/lib/feedback/tour-token";
import { ownerRequest } from "@/lib/widget/owner-request";
import { appUrl } from "@/lib/email";
import {
  KNOWN_FIXES_MAX,
  OWNER_CHANGE_TEXT_MAX,
  OWNER_CHANGES_FETCH,
  OWNER_CHANGES_MAX,
  orderForOwner,
  ownerStatusFor,
  type KnownFix,
  type OwnerChange,
} from "@/lib/feedback/owner-view";

/**
 * "Your changes", for the panel on the owner's own site.
 *
 * The one read the widget makes with the owner pass. It answers what the Loki
 * inbox answers — where each of this project's changes is — through the same
 * `attachFeedbackWork` the inbox uses, so a ledger refreshed here (and the
 * "a fix is live" it may announce) is the owner's own path running for the
 * owner, on the surface they actually return to. The words are the owner
 * view's (owner-view.ts); the work view itself never leaves the server.
 *
 * Guarded like every widget route — active token, origin allowlist, per-IP
 * and per-token limits — and, on top, the pass must name this project and
 * this owner, exactly as ingest checks it. Without a valid pass this answers
 * nothing: a stranger with the public token learns nothing about the inbox.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

/** The panel asks every half minute while something is moving. */
const RATE_PER_IP = 120;

const Body = z.object({
  token: z.string().startsWith("fcw_").max(100),
  ownerPass: z.string().min(1).max(400),
});

const corsJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: CORS_HEADERS });

export function OPTIONS(req: NextRequest) {
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
  if (!checkRateLimit(`widget-changes:ip:${ip}`, RATE_PER_IP, RATE_LIMIT_WINDOW_SHORT_MS)) {
    return corsJson({ error: "Too many requests" }, 429);
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return corsJson({ error: "Invalid request" }, 400);
  const data = parsed.data;

  // Same test as ingest: this project, this owner, unexpired. The widget
  // forgets a pass the server refuses, so say so plainly rather than 403.
  const who = await ownerRequest(req, data);
  if (who.kind === "error") return corsJson({ error: who.error }, who.status);
  if (who.kind === "stranger") return corsJson({ ok: true, owner: false, changes: [] });
  const { token, holder } = who;

  const [all, key, theme] = await Promise.all([
    listProjectFeedback(token.userId, token.projectId, OWNER_CHANGES_FETCH),
    getWidgetProjectKey(token.projectId, token.userId),
    // The mode they chose in Loki, so their site's panel shows in it too
    // (widget/theme-mode.ts). Never chosen = what Loki shows them: dark.
    getUserTheme(holder.userId).catch(() => null),
  ]);
  // "Your changes" means yours: what the owner asked for, and what Loki filed
  // on its own while watching or reviewing. A stranger's "so nice picture!"
  // listed as the owner's own request (2026-10-09) is not a status, it is
  // noise — visitors' notes are counted, and read in Loki.
  const mine = all
    .filter((i) => i.source === FEEDBACK_SOURCE.OWNER || i.source === FEEDBACK_SOURCE.AI_REVIEW)
    .slice(0, OWNER_CHANGES_MAX);
  const visitors = all.filter(
    (i) =>
      i.source !== FEEDBACK_SOURCE.OWNER &&
      i.source !== FEEDBACK_SOURCE.AI_REVIEW &&
      (i.status === FEEDBACK_STATUS.NEW || i.status === FEEDBACK_STATUS.DISPATCHED),
  ).length;
  // What Watch noticed and the owner (or Watch itself) filed: keyed rows,
  // open or settled, so the next visit's remark finds its fix. Beyond the
  // twelve the strip shows — a finding fixed last month still answers.
  const keyed = all.filter((i) => i.noticeKey).slice(0, KNOWN_FIXES_MAX);
  const withWork = await attachFeedbackWork(token.userId, [
    ...mine,
    ...keyed.filter((k) => !mine.some((m) => m.id === k.id)),
  ]);
  const inbox = `${appUrl()}/feedback${key ? `?project=${encodeURIComponent(key)}` : ""}`;
  const known: KnownFix[] = withWork.flatMap((item) => {
    if (!item.noticeKey) return [];
    const status = ownerStatusFor(item.work, item.requiresReview);
    const liveHref = livePageHref(item.liveUrl, item.url, item.page);
    return [
      {
        key: item.noticeKey,
        id: item.id,
        at: item.createdAt.toISOString(),
        label: status.label,
        tone: status.tone,
        detail: status.detail,
        live: status.live,
        settled: status.settled,
        href: status.live && liveHref ? liveHref : inbox,
      },
    ];
  });

  const changes: OwnerChange[] = orderForOwner(
    withWork
      .filter((item) => mine.some((m) => m.id === item.id))
      .map((item) => {
        const status = ownerStatusFor(item.work, item.requiresReview);
        const liveHref = livePageHref(item.liveUrl, item.url, item.page);
        // "See it" is the walkthrough of THIS change on the live page, minted for
        // the owner; it is offered only once the change is actually live.
        const href = status.live
          ? liveHref
            ? tourSiteUrl(liveHref, createTourToken(item.id))
            : inbox
          : status.needsYou
            ? inbox
            : item.dispatchedRunId
              ? `${appUrl()}${watchFixPath(item.id)}`
              : null;
        return {
          id: item.id,
          text: item.suggestion.slice(0, OWNER_CHANGE_TEXT_MAX),
          at: item.createdAt.toISOString(),
          label: status.label,
          tone: status.tone,
          detail: status.detail,
          live: status.live,
          settled: status.settled,
          needsYou: status.needsYou,
          href,
          action: status.live
            ? liveHref
              ? "See it"
              : "Open in Loki"
            : status.needsYou
              ? "Open in Loki"
              : item.dispatchedRunId
                ? "Watch it"
                : null,
        };
      }),
  ).map(({ needsYou: _needsYou, ...change }) => change);
  return corsJson({
    ok: true,
    owner: true,
    changes,
    known,
    inbox,
    visitors,
    theme: theme ?? DEFAULT_THEME_MODE,
  });
}
