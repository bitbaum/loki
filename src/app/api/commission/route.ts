import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { WebsiteBriefBody } from "@/lib/website-brief";
import { getStudioCommission, studioSuggestion } from "@/lib/studio-commission";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_SHORT_MS, RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import { getWidgetTokenByToken } from "@/db/queries/widget-tokens";
import { bumpDuplicateFeedback, insertSiteFeedback } from "@/db/queries/site-feedback";
import { feedbackContentHash } from "@/lib/feedback/content-hash";
import { createFeedbackClaimToken } from "@/lib/feedback/claim-token";
import { FEEDBACK_SOURCE, WIDGET_TOKEN_STATUS } from "@/lib/constants/statuses";
import { COMMISSION } from "@/config/commission";

const Body = WebsiteBriefBody.extend({
  requestId: z.uuid(),
  contact: z.union([z.email().max(200), z.literal("")]).optional(),
  company: z.string().max(200).optional(), // honeypot, never a required field
  offerId: z.string().max(80),
});

/** Public, write-only intake into the existing studio inbox. It neither
 *  charges the visitor nor dispatches work on an arbitrary website. */
export async function POST(req: NextRequest) {
  if (!checkRateLimit(`commission:ip:${getClientIp(req)}`, 10, RATE_LIMIT_WINDOW_SHORT_MS)) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check your request." },
      { status: 400 },
    );
  }
  if (parsed.data.company) return NextResponse.json({ ok: true });
  const contract = await getStudioCommission();
  if (!contract) {
    return NextResponse.json(
      {
        error:
          "The studio's current terms could not be loaded. Your brief is still here; try again.",
      },
      { status: 503 },
    );
  }
  if (parsed.data.offerId !== contract.offer.id) {
    return NextResponse.json(
      {
        error:
          "The published offer changed. Reload to review its current terms; your brief is saved.",
      },
      { status: 409 },
    );
  }
  // The studio's fixed public contract identifies the correct tenant. A caller
  // cannot choose a token, owner, project, source or execution mode.
  const token = await getWidgetTokenByToken(contract.feedbackToken);
  if (!token || token.status !== WIDGET_TOKEN_STATUS.ACTIVE) {
    return NextResponse.json(
      { error: "Studio intake is unavailable. Your brief is saved; try again later." },
      { status: 503 },
    );
  }
  if (!checkRateLimit(`feedback:token:${token.id}`, 200, RATE_LIMIT_WINDOW_LONG_MS)) {
    return NextResponse.json(
      { error: "Studio intake is busy. Please try again shortly." },
      { status: 429 },
    );
  }
  const suggestion = studioSuggestion(parsed.data, contract);
  const contentHash = feedbackContentHash(
    `${parsed.data.requestId}\n${suggestion}\nReply: ${parsed.data.contact ?? ""}`,
    COMMISSION.path,
  );
  const duplicate = await bumpDuplicateFeedback(token.projectId, contentHash);
  const created = duplicate
    ? null
    : await insertSiteFeedback({
        projectId: token.projectId,
        userId: token.userId,
        tokenId: token.id,
        suggestion,
        contact: parsed.data.contact || null,
        page: COMMISSION.path,
        url: req.nextUrl.origin + COMMISSION.path,
        pageTitle: "Change an existing website",
        source: FEEDBACK_SOURCE.VISITOR,
        contentHash,
        userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      });
  const id = duplicate ?? created?.id;
  if (!id)
    return NextResponse.json(
      { error: "The request was not saved. Please try again." },
      { status: 500 },
    );
  const claim = createFeedbackClaimToken(id);
  return NextResponse.json({
    ok: true,
    claimPath: `/claim-feedback?token=${claim}`,
    availability: contract.availability,
  });
}
