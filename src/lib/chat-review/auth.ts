import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

/**
 * The door every product's review-export stands behind: the shared
 * `CHAT_REVIEW_TOKEN` as a bearer, compared in constant time. 401 otherwise;
 * 503 while the token is not set — the route is never open, in any
 * environment, because what it serves is every account's conversations.
 * Returns the refusal to send, or null to proceed (the cron-auth shape).
 */
export function requireChatReviewAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.CHAT_REVIEW_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json({ error: "CHAT_REVIEW_TOKEN not configured" }, { status: 503 });
  }
  const header = req.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
