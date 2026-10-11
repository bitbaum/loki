import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/route-helpers";
import { isValidUuid } from "@/lib/utils";
import { getSessionUserId } from "@/lib/session";
import { getFeedbackScreenshots, getFeedbackWithProject } from "@/db/queries/site-feedback";

/**
 * One visitor-attached screenshot as an image, for an <img> in a chat update
 * (lib/loki/update-images.ts). The JSON sibling (../route.ts) serves the
 * inbox. Same gate: /api/feedback is excluded from the auth middleware for
 * the public ingest, so the session + ownership check here is the ONLY gate.
 */
const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; n: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const { id, n } = await params;
  if (!isValidUuid(id) || !/^\d{1,2}$/.test(n)) return jsonError("Not found", 404);

  const row = await getFeedbackWithProject(userId, id);
  if (!row) return jsonError("Feedback not found", 404);
  const shot = (await getFeedbackScreenshots(row.ownerUserId, id))?.[Number(n)];
  const m = shot?.match(DATA_URL);
  if (!m) return jsonError("No such screenshot", 404);

  return new NextResponse(Buffer.from(m[2], "base64"), {
    headers: {
      "Content-Type": m[1],
      // Owner-only and immutable per row.
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
