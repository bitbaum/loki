import { NextRequest, NextResponse } from "next/server";
import { readIdParam, jsonError } from "@/lib/api/route-helpers";
import { getSessionUserId } from "@/lib/session";
import { getFeedbackScreenshots, getFeedbackWithProject } from "@/db/queries/site-feedback";

/**
 * The visitor-attached images for one feedback row. Returns JSON array of
 * data URLs. Kept out of the inbox list payload on purpose — the bytes load
 * only when the operator opens them. NOTE: /api/feedback is excluded from the
 * auth middleware (the public ingest lives there), so the session check below
 * is the ONLY gate on this handler — do not remove it.
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const row = await getFeedbackWithProject(userId, idOrResp);
  if (!row) return jsonError("Feedback not found", 404);
  const screenshots = await getFeedbackScreenshots(row.ownerUserId, idOrResp);
  if (!screenshots || screenshots.length === 0) {
    return jsonError("No screenshots", 404);
  }

  return NextResponse.json(
    { screenshots },
    {
      headers: {
        // Owner-only, immutable per row — cache privately.
        "Cache-Control": "private, max-age=3600",
      },
    },
  );
}
