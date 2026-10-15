import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/session";
import { jsonError, readIdParam } from "@/lib/api/route-helpers";
import { getSiteReview, reviewImageKey } from "@/db/queries/site-reviews";
import { db } from "@/db";
import { siteReviewEvents } from "@/db/schema/site-reviews";

/** Private JPEGs are fetched only when the frame changes, never on every feed poll. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const id = await readIdParam(ctx.params);
  if (id instanceof NextResponse) return id;
  const row = await getSiteReview(userId, id);
  if (!row) return jsonError("Not found", 404);
  const event = req.nextUrl.searchParams.get("event");
  let image: string | null = null;
  if (event) {
    if (!z.uuid().safeParse(event).success) return jsonError("Invalid evidence", 400);
    image =
      (
        await db
          .select({ image: siteReviewEvents.image })
          .from(siteReviewEvents)
          .where(
            and(
              eq(siteReviewEvents.id, event),
              eq(siteReviewEvents.reviewId, id),
              eq(siteReviewEvents.userId, userId),
            ),
          )
          .limit(1)
      )[0]?.image ?? null;
  } else if (row.frame && req.nextUrl.searchParams.get("key") === reviewImageKey(row.frame.image))
    image = row.frame.image;
  if (!image) return jsonError("Frame not available", 404);
  return new Response(Buffer.from(image.split(",")[1]!, "base64"), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
