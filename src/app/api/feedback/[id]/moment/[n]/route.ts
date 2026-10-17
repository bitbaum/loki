import { NextRequest } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { jsonError, jsonOk } from "@/lib/api/route-helpers";
import { isValidUuid } from "@/lib/utils";
import { getFeedbackWithProject } from "@/db/queries/site-feedback";
import { livePageHref } from "@/lib/feedback/fix-shipping";
import { takePagePicture } from "@/lib/feedback/page-picture";
import { checkRateLimit } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";

/**
 * GET /api/feedback/[id]/moment/[n] — the picture of what the reporter was
 * looking at during moment n of their walk: the page they were on, scrolled
 * to the control they tapped (or as far as they had scrolled), at phone
 * size. Taken on the server, after the fact, from the moment the widget
 * recorded (widget/moments-contract.ts) — a page cannot film itself on a
 * phone, but Loki can open the same page and look.
 *
 * Owner or editor only, asked for when a card is opened, never from a
 * timer; one browser at a time (page-picture.ts), kept in memory for a
 * while so a second look is free. NOTE: /api/feedback is excluded from the
 * auth middleware, so the session check below is the ONLY gate.
 */
const PICTURES_PER_HOUR = 60;
const KEEP_MS = 15 * 60_000;
const KEEP_MAX = 60;
const kept = new Map<string, { picture: string; at: number }>();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; n: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const { id, n } = await params;
  if (!isValidUuid(id)) return jsonError("Invalid id", 400);
  const index = Number(n);
  if (!Number.isInteger(index) || index < 0) return jsonError("Invalid moment", 400);

  const row = await getFeedbackWithProject(userId, id);
  if (!row) return jsonError("Feedback not found", 404);
  if (!row.canEdit) return jsonError("Only project owners and editors can see this", 403);
  const moment = row.feedback.moments?.[index];
  if (!moment) return jsonError("No such moment", 404);

  const key = `${id}:${index}`;
  const have = kept.get(key);
  if (have && Date.now() - have.at < KEEP_MS)
    return jsonOk({ picture: have.picture, at: new Date(have.at).toISOString() });

  if (!checkRateLimit(`moment-picture:${userId}`, PICTURES_PER_HOUR, RATE_LIMIT_WINDOW_LONG_MS))
    return jsonError("Too many pictures — try again in a bit", 429);

  // The page the moment was on, served from the project's live host.
  const url = livePageHref(row.liveUrl, row.feedback.url, moment.page);
  if (!url) return jsonError("No live page to look at", 404);
  const shot = await takePagePicture(url, moment.tap?.selector ?? null, {
    scrollY: moment.scrollY ?? null,
  });
  if (!shot.ok)
    return jsonError(
      shot.reason !== "did-not-load"
        ? "No browser on the server to take the picture"
        : "The page did not load",
      503,
    );
  const picture = `data:${shot.mimeType};base64,${shot.base64}`;
  kept.set(key, { picture, at: Date.now() });
  if (kept.size > KEEP_MAX) kept.delete(kept.keys().next().value!);
  return jsonOk({ picture, at: new Date().toISOString() });
}
