import { NextResponse } from "next/server";
import { readIdParam, jsonError, jsonOk } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { getFeedbackWithProject } from "@/db/queries/site-feedback";
import { createTourToken } from "@/lib/feedback/tour-token";

/**
 * Mint the ticket for "Watch the fix" on one feedback item. The row builds the
 * link itself (the live page it already knows + this token in the fragment),
 * so this only proves the signed-in person may see that item's walkthrough.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const row = await getFeedbackWithProject(userId, idOrResp);
  if (!row) return jsonError("Feedback not found", 404);
  return jsonOk({ token: createTourToken(row.feedback.id) });
}
