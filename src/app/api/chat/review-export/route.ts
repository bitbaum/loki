import { NextRequest, NextResponse } from "next/server";
import { requireChatReviewAuth } from "@/lib/chat-review/auth";
import { listConversationsForReview } from "@/db/queries/chat-feedback";
import { toTranscript } from "@/lib/chat-review/transcripts";
import { REVIEW_EXPORT_LIMIT, REVIEW_WINDOW_MS } from "@/config/chat-review";
import { lokiChatScope } from "@/lib/loki-core";
import { APP_SLUG } from "@/config/brand";

/**
 * GET /api/chat/review-export?since=<ISO>&limit=50 — Loki's day of
 * conversations in chatkit's `ChatTranscript` shape, for the nightly fleet
 * chat review (docs/architecture/chat-review.md). Every product in the loop
 * serves the same route behind the same shared `CHAT_REVIEW_TOKEN`; Loki's
 * reviewer reads this one like any other.
 *
 * Bearer token, compared in constant time; 401 otherwise; 503 while the
 * token is not set — never open (lib/chat-review/auth.ts). No names, emails
 * or user ids leave: the ids are Loki's own, and temporary chats are never
 * in it.
 */
export async function GET(req: NextRequest) {
  const denied = requireChatReviewAuth(req);
  if (denied) return denied;

  const sinceRaw = req.nextUrl.searchParams.get("since");
  const sinceParsed = sinceRaw ? Date.parse(sinceRaw) : NaN;
  const since = Number.isFinite(sinceParsed)
    ? new Date(sinceParsed)
    : new Date(Date.now() - REVIEW_WINDOW_MS);
  const limitRaw = Number(req.nextUrl.searchParams.get("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), REVIEW_EXPORT_LIMIT)
      : REVIEW_EXPORT_LIMIT;

  const rows = await listConversationsForReview(since, limit);
  const transcripts = rows
    .map(({ conversation, messages, feedback }) =>
      toTranscript({
        id: conversation.id,
        updatedAt: conversation.updatedAt,
        projectKeys: conversation.projectKeys,
        messages,
        feedback,
      }),
    )
    .filter((t) => t.turns.length > 0);

  return NextResponse.json(
    { product: APP_SLUG, scope: lokiChatScope(), transcripts },
    { headers: { "Cache-Control": "no-store" } },
  );
}
