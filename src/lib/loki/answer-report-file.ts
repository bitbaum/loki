import { FEEDBACK_SOURCE, WIDGET_TOKEN_STATUS } from "@/lib/constants/statuses";
import { getWidgetTokenByToken } from "@/db/queries/widget-tokens";
import { bumpDuplicateFeedback, insertSiteFeedback } from "@/db/queries/site-feedback";
import { feedbackContentHash } from "@/lib/feedback/content-hash";
import { notifyFeedbackReceived } from "@/lib/feedback/notify-new";
import { appUrl } from "@/lib/email";
import { ANSWER_REPORT_PAGE, buildAnswerReport } from "./answer-report";

export type AnswerReportFiled =
  { ok: true; id: string; duplicate: boolean } | { ok: false; reason: "not_configured" | "failed" };

/**
 * A thumbs-down on a Loki answer, filed as a feedback report into Loki's OWN
 * project: the one FEEDBACK_WIDGET_TOKEN belongs to, exactly where the
 * dogfood widget files. So it lands in the operator's /feedback inbox beside
 * every other report, can be implemented like one, and shows up in the
 * reporter's own /my-feedback (reporterUserId). The token never leaves the
 * server. Without one (a self-hosted copy that has not provisioned it) the
 * answer says so instead of pretending the report went somewhere.
 */
export async function fileAnswerReport(input: {
  reporterUserId: string;
  answer: string;
  question: string | null;
  note: string | null;
  userAgent?: string | null;
}): Promise<AnswerReportFiled> {
  if (!input.answer.trim()) return { ok: false, reason: "failed" };
  const raw = process.env.FEEDBACK_WIDGET_TOKEN?.trim();
  const token = raw ? await getWidgetTokenByToken(raw) : null;
  if (!token || token.status !== WIDGET_TOKEN_STATUS.ACTIVE) {
    return { ok: false, reason: "not_configured" };
  }
  const suggestion = buildAnswerReport(input);
  const contentHash = feedbackContentHash(suggestion, ANSWER_REPORT_PAGE);
  const bumped = await bumpDuplicateFeedback(token.projectId, contentHash);
  if (bumped) return { ok: true, id: bumped, duplicate: true };
  const created = await insertSiteFeedback({
    projectId: token.projectId,
    userId: token.userId,
    reporterUserId: input.reporterUserId,
    tokenId: token.id,
    suggestion,
    page: ANSWER_REPORT_PAGE,
    url: `${appUrl()}${ANSWER_REPORT_PAGE}`,
    pageTitle: "Loki chat",
    source: FEEDBACK_SOURCE.VISITOR,
    contentHash,
    userAgent: input.userAgent?.slice(0, 300) ?? null,
  });
  if (!created) return { ok: false, reason: "failed" };
  void notifyFeedbackReceived(created);
  return { ok: true, id: created.id, duplicate: false };
}
