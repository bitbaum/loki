import { NextRequest, NextResponse } from "next/server";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import { FEEDBACK_SOURCE, WIDGET_TOKEN_STATUS } from "@/lib/constants/statuses";
import { getWidgetTokenByToken } from "@/db/queries/widget-tokens";
import { bumpDuplicateFeedback, insertSiteFeedback } from "@/db/queries/site-feedback";
import { feedbackContentHash } from "@/lib/feedback/content-hash";
import { notifyFeedbackReceived } from "@/lib/feedback/notify-new";
import { appUrl } from "@/lib/email";
import { ANSWER_REPORT_PAGE, buildAnswerReport } from "@/lib/loki/answer-report";

/**
 * POST /api/loki/answer-feedback — a thumbs-down on a Loki answer, filed as a
 * feedback report into Loki's OWN project: the one FEEDBACK_WIDGET_TOKEN
 * belongs to, exactly where the dogfood widget files. So it lands in the
 * operator's /feedback inbox beside every other report, can be implemented
 * like one, and shows up in the reporter's own /my-feedback (reporterUserId).
 *
 * Signed-in only; the token never leaves the server. Without the token (a
 * self-hosted copy that has not provisioned one) the answer says so instead
 * of pretending the report went somewhere.
 */
const Body = z.object({
  answer: z.string().trim().min(1).max(40_000),
  question: z.string().max(20_000).nullable().optional(),
  note: z.string().max(2_000).nullable().optional(),
});

const REPORTS_PER_HOUR = 20;

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  if (!checkRateLimit(`answer-feedback:${userId}`, REPORTS_PER_HOUR, RATE_LIMIT_WINDOW_LONG_MS)) {
    return jsonError("That's a lot of reports in an hour — try again a little later.", 429);
  }

  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const raw = process.env.FEEDBACK_WIDGET_TOKEN?.trim();
  const token = raw ? await getWidgetTokenByToken(raw) : null;
  if (!token || token.status !== WIDGET_TOKEN_STATUS.ACTIVE) {
    return jsonError(
      "Feedback isn't set up on this Loki yet (FEEDBACK_WIDGET_TOKEN), so the report could not be filed.",
      503,
    );
  }

  const suggestion = buildAnswerReport(dataOrResp);
  const contentHash = feedbackContentHash(suggestion, ANSWER_REPORT_PAGE);
  const bumped = await bumpDuplicateFeedback(token.projectId, contentHash);
  if (bumped) return jsonOk({ id: bumped, duplicate: true });

  const created = await insertSiteFeedback({
    projectId: token.projectId,
    userId: token.userId,
    reporterUserId: userId,
    tokenId: token.id,
    suggestion,
    page: ANSWER_REPORT_PAGE,
    url: `${appUrl()}${ANSWER_REPORT_PAGE}`,
    pageTitle: "Loki chat",
    source: FEEDBACK_SOURCE.VISITOR,
    contentHash,
    userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
  });
  if (!created) return jsonError("Could not file the report — try again.", 500);
  void notifyFeedbackReceived(created);
  return jsonOk({ id: created.id });
}
