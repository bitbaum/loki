import { NextRequest, NextResponse } from "next/server";
import { FEEDBACK_REASONS } from "@bitbaum/chatkit";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import { getConversationWithMessages } from "@/db/queries/conversations";
import { insertChatFeedback } from "@/db/queries/chat-feedback";
import { fileAnswerReport } from "@/lib/loki/answer-report-file";

/**
 * POST /api/chat/feedback — a thumb under a Loki answer (chatkit's
 * `AnswerFeedback`, docs/architecture/chat-review.md). Signed-in only, and
 * the conversation must be the person's own.
 *
 * Two things happen to it. It is kept in `chat_feedback`, beside the
 * conversation, so the nightly review reads the person's verdict next to its
 * own. And a thumb down is filed as a report into Loki's OWN feedback inbox —
 * the same path the "Bad answer" button took before chatkit drew the thumbs
 * (lib/loki/answer-report-file.ts) — so the person can follow it in
 * /my-feedback and the operator sees it the same morning, not after the
 * night's review. The report's failure never loses the thumb.
 */
const Body = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  verdict: z.enum(["up", "down"]),
  reason: z.enum(FEEDBACK_REASONS).optional(),
  text: z.string().trim().max(1000).optional(),
});

const THUMBS_PER_HOUR = 60;

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  if (!checkRateLimit(`chat-feedback:${userId}`, THUMBS_PER_HOUR, RATE_LIMIT_WINDOW_LONG_MS)) {
    return jsonError("That's a lot of feedback in an hour — try again a little later.", 429);
  }
  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const data = dataOrResp;

  const thread = await getConversationWithMessages(userId, data.conversationId);
  if (!thread) return jsonError("Conversation not found", 404);
  const row = await insertChatFeedback({
    conversationId: data.conversationId,
    messageId: data.messageId,
    verdict: data.verdict,
    reason: data.reason ?? null,
    text: data.text || null,
  });
  if (!row) return jsonError("That message is not an answer in this conversation", 404);

  let reportId: string | null = null;
  if (data.verdict === "down") {
    const at = thread.messages.findIndex((m) => m.id === data.messageId);
    const answer = thread.messages[at];
    const question = thread.messages
      .slice(0, at)
      .reverse()
      .find((m) => m.role === "user");
    const reason = data.reason ? data.reason.replace(/_/g, " ") : null;
    const note = [reason, data.text].filter(Boolean).join(" — ") || null;
    const filed = await fileAnswerReport({
      reporterUserId: userId,
      answer: answer?.content ?? "",
      question: question?.content ?? null,
      note,
      userAgent: req.headers.get("user-agent"),
    });
    reportId = filed.ok ? filed.id : null;
  }
  return jsonOk({ id: row.id, reportId });
}
