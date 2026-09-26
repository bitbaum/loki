import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_SHORT_MS, RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import {
  FEEDBACK_SCOPE_VALUES,
  FEEDBACK_SELF_ASSERTED_SOURCES,
  FEEDBACK_SOURCE,
  WIDGET_TOKEN_STATUS,
} from "@/lib/constants/statuses";
import { getWidgetTokenByToken } from "@/db/queries/widget-tokens";
import { bumpDuplicateFeedback, insertSiteFeedback } from "@/db/queries/site-feedback";
import { feedbackContentHash } from "@/lib/feedback/content-hash";
import { notifyFeedbackReceived } from "@/lib/feedback/notify-new";
import { createFeedbackClaimToken } from "@/lib/feedback/claim-token";
import { appUrl } from "@/lib/email";
import { verifyOwnerPass } from "@/lib/feedback/owner-pass";
import { implementFeedback } from "@/lib/feedback/implement";

/** Owner notes start an agent each; this bounds what a leaked pass can spend. */
const OWNER_BUILDS_PER_DAY = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Public ingest for the embeddable feedback widget (docs/architecture/
 * feedback-widget.md). Cross-origin POST from customer sites, so this route:
 *   • is excluded from the auth middleware in proxy.ts
 *   • answers CORS preflight (JSON POST always triggers one)
 *   • authenticates via the write-only fcw_* widget token in the body
 *
 * ACAO is `*` — the token grants submit-only capability and no cookies are
 * involved, so origin secrecy buys nothing. The per-token `origins` allowlist
 * is enforced server-side against the Origin header instead.
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

const FeedbackBody = z.object({
  token: z.string().startsWith("fcw_").max(100),
  suggestion: z.string().trim().min(1).max(2000),
  contact: z.string().max(200).optional(),
  page: z.string().max(300).optional(),
  url: z.string().max(1000).optional(),
  pageTitle: z.string().max(300).optional(),
  scope: z.enum(FEEDBACK_SCOPE_VALUES).optional(),
  // Who filed it — the widget omits this (→ visitor); the AI reviewer and
  // synthesizer declare themselves. Self-asserted via the public token, so a
  // routing hint, not a trust boundary.
  source: z.enum(FEEDBACK_SELF_ASSERTED_SOURCES).optional(),
  /** The owner's signed pass (feedback/owner-pass.ts), which the widget picked
   *  up from Loki's "Open your site" link. Verified below, never trusted. */
  ownerPass: z.string().max(300).optional(),
  /** Visitor-attached images, client-downscaled by the widget. Data URLs only;
   *  the char cap bounds storage per image (~450 KB each). */
  screenshots: z
    .array(
      z
        .string()
        .regex(/^data:image\/(jpeg|png|webp);base64,/)
        .max(600_000),
    )
    .max(5)
    .optional(),
  selectedElements: z
    .array(
      z.object({
        elementType: z.string().max(100),
        elementText: z.string().max(300),
        selector: z.string().max(500),
      }),
    )
    .max(10)
    .optional(),
});

export function OPTIONS(req: NextRequest) {
  // Reflect whatever headers the browser asks for: customer sites monkey-patch
  // window.fetch and stamp extra headers (e.g. a csrf header) onto EVERY POST,
  // including the widget's cross-origin one — a hardcoded allowlist fails their
  // preflight and silently kills ingest. Header names are not a security
  // boundary here; the Origin allowlist check in POST is.
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
  if (!checkRateLimit(`feedback:ip:${ip}`, 10, RATE_LIMIT_WINDOW_SHORT_MS)) {
    return corsError("Too many submissions, try again later", 429);
  }

  const raw = await req.json().catch(() => null);
  const parsed = FeedbackBody.safeParse(raw);
  if (!parsed.success) return corsError("Invalid submission", 400);
  const data = parsed.data;

  const token = await getWidgetTokenByToken(data.token);
  if (!token) return corsError("Unknown or revoked widget token", 403);

  // Pause has to mean pause. The boot call stops the widget RENDERING, but the
  // token is public and sits in the customer's page source, so a paused project
  // was still accepting POSTs from anyone who kept a copy — and the operator,
  // seeing no widget on the site, had no reason to think otherwise. The UI
  // offers Pause as the way to stop collecting; make the ingest agree with it.
  if (token.status !== WIDGET_TOKEN_STATUS.ACTIVE) {
    return corsError("Feedback is paused for this site", 403);
  }

  // Server-side origin allowlist (empty/null = any origin).
  const origin = req.headers.get("origin");
  if (token.origins?.length && (!origin || !token.origins.includes(origin))) {
    return corsError("Origin not allowed for this widget", 403);
  }

  // Second-tier cap per token: one hostile page can't flood a project's inbox
  // from many IPs without tripping this.
  if (!checkRateLimit(`feedback:token:${token.id}`, 200, RATE_LIMIT_WINDOW_LONG_MS)) {
    return corsError("Too many submissions, try again later", 429);
  }

  // The owner's own note, proven by the pass: same project, and the pass was
  // issued to the person who owns it. Anything else is an ordinary visitor.
  const pass = data.ownerPass ? verifyOwnerPass(data.ownerPass) : null;
  const fromOwner = !!pass && pass.projectId === token.projectId && pass.userId === token.userId;

  // Dedupe at ingest: the same complaint filed again bumps the existing open
  // row's duplicate_count instead of creating a new row — volume signal kept,
  // inbox noise dropped. Idempotent for the visitor (they still see success).
  const contentHash = feedbackContentHash(data.suggestion, data.page ?? null);
  const bumped = await bumpDuplicateFeedback(token.projectId, contentHash);
  if (bumped) {
    // The owner saying the same thing again means "do it": a failed attempt
    // starts again, one already running answers "already on it". Answering as
    // a visitor here also made the widget drop a perfectly good pass.
    if (fromOwner) {
      const build = await startOwnerBuild(token.userId, token.projectId, bumped);
      return NextResponse.json(
        { ok: true, owner: true, duplicateOf: bumped, ...build },
        { headers: CORS_HEADERS },
      );
    }
    const claim = createFeedbackClaimToken(bumped);
    return NextResponse.json(
      { ok: true, duplicateOf: bumped, claimUrl: `${appUrl()}/claim-feedback?token=${claim}` },
      { headers: CORS_HEADERS },
    );
  }

  const created = await insertSiteFeedback({
    projectId: token.projectId,
    userId: token.userId,
    tokenId: token.id,
    suggestion: data.suggestion,
    contact: data.contact ?? null,
    page: data.page ?? null,
    url: data.url ?? null,
    pageTitle: data.pageTitle ?? null,
    scope: data.scope ?? null,
    source: fromOwner ? FEEDBACK_SOURCE.OWNER : (data.source ?? FEEDBACK_SOURCE.VISITOR),
    contentHash,
    screenshots: data.screenshots ?? null,
    selectedElements: data.selectedElements ?? null,
    userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
  });
  if (!created) return corsError("Could not store feedback, try again later", 500);

  // Persist-first, announce second (the doc's "optional notification later",
  // finally): fire-and-forget so a notify hiccup can never fail the ingest.
  // Duplicate bumps above stay silent — the row announced when first filed.
  void notifyFeedbackReceived(created);

  // The owner said what to change; saying it IS the decision. Start the fix
  // now, through the same path as the Implement button, and tell the widget
  // how it went so the owner is never left guessing. A refusal is reported,
  // not hidden: the note is stored either way and waits in the inbox.
  if (fromOwner) {
    const build = await startOwnerBuild(token.userId, token.projectId, created.id);
    return NextResponse.json({ ok: true, owner: true, ...build }, { headers: CORS_HEADERS });
  }

  const claim = createFeedbackClaimToken(created.id);
  return NextResponse.json(
    { ok: true, claimUrl: `${appUrl()}/claim-feedback?token=${claim}` },
    { headers: CORS_HEADERS },
  );
}

async function startOwnerBuild(
  ownerUserId: string,
  projectId: string,
  feedbackId: string,
): Promise<{ building: boolean; buildNote?: string }> {
  if (!checkRateLimit(`feedback:owner-build:${projectId}`, OWNER_BUILDS_PER_DAY, DAY_MS)) {
    return {
      building: false,
      buildNote: "Saved. You have sent a lot today, so this one waits in Loki for you to start.",
    };
  }
  try {
    const { status, body } = await implementFeedback(ownerUserId, feedbackId);
    if (status < 400 && typeof body.runId === "string") return { building: true };
    // 409 from a run that is queued or working: the note is already being
    // built, which is exactly what the owner wants to hear.
    if (status === 409 && body.alreadyRunning === true) return { building: true };
    const reason = typeof body.error === "string" ? body.error : null;
    return {
      building: false,
      buildNote: reason
        ? `Saved, but it could not start: ${reason}`
        : "Saved, but it could not start yet. It waits in Loki under Feedback.",
    };
  } catch {
    return {
      building: false,
      buildNote: "Saved, but it could not start yet. It waits in Loki under Feedback.",
    };
  }
}
