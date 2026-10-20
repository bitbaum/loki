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
  ownerTap,
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

/**
 * Every answer carries the CORS headers, failures included. An exception that
 * escaped to Next's own 500 had none, so on a customer's site the browser
 * hid the status and the widget saw "never answered" — which it reports as a
 * fault of its own (widget/self-watch.ts).
 */
export async function POST(req: NextRequest) {
  try {
    return await answer(req);
  } catch (error) {
    console.error("[widget-changes] failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return corsJson({ error: "Could not read your changes just now" }, 503);
  }
}

async function answer(req: NextRequest) {
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
  //
  // All of them, not the newest twelve: the line counts what needs the owner,
  // and counting inside a window of the newest let three fresh notes push
  // three failed fixes out of it — "9 changes need you" became 6 with nothing
  // done (2026-10-20). The list is cut to twelve AFTER ordering, so what needs
  // the owner is always in it.
  const mine = all.filter(
    (i) => i.source === FEEDBACK_SOURCE.OWNER || i.source === FEEDBACK_SOURCE.AI_REVIEW,
  );
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
  // One rule for where a row's tap goes (owner-view ownerTap). A failed
  // attempt opens THAT run's Watch page through the stable watch-fix address.
  const tap = (item: (typeof withWork)[number], tour: boolean) => {
    const status = ownerStatusFor(item.work, item.requiresReview);
    const liveHref = livePageHref(item.liveUrl, item.url, item.page);
    const { to, action } = ownerTap(status, !!item.dispatchedRunId);
    const href =
      to === "live"
        ? liveHref
          ? // "See it" is the walkthrough of THIS change, minted for the owner.
            tour
            ? tourSiteUrl(liveHref, createTourToken(item.id))
            : liveHref
          : inbox
        : to === "run"
          ? `${appUrl()}${watchFixPath(item.id)}`
          : to === "inbox"
            ? inbox
            : null;
    return { status, href, action: to === "live" && !liveHref ? "Open in Loki" : action };
  };
  const known: KnownFix[] = withWork.flatMap((item) => {
    if (!item.noticeKey) return [];
    const { status, href, action } = tap(item, false);
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
        href: href ?? inbox,
        action: action ?? "Open in Loki",
      },
    ];
  });

  const ordered: OwnerChange[] = orderForOwner(
    withWork
      .filter((item) => mine.some((m) => m.id === item.id))
      .map((item) => {
        const { status, href, action } = tap(item, true);
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
          action,
        };
      }),
  );
  return corsJson({
    ok: true,
    owner: true,
    changes: ordered.slice(0, OWNER_CHANGES_MAX),
    // What the panel's line counts: every row waiting on the owner, even
    // past the twelve the list carries (ordering puts them first).
    needsYou: ordered.filter((c) => c.needsYou).length,
    known,
    inbox,
    visitors,
    theme: theme ?? DEFAULT_THEME_MODE,
  });
}
