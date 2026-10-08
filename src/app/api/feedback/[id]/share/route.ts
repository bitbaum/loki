import { NextResponse } from "next/server";
import { APP_URL } from "@/config/brand";
import { readIdParam, jsonError, jsonOk } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { getFeedbackWithProject } from "@/db/queries/site-feedback";
import { createShareToken, sharedWatchPath } from "@/lib/feedback/tour-token";

/**
 * The share link for one fix's walkthrough (app/w/[token]): anyone who opens
 * it watches the change on the live site, in plain words. Only someone who
 * may see the item can mint one.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const row = await getFeedbackWithProject(userId, idOrResp);
  if (!row) return jsonError("Feedback not found", 404);
  return jsonOk({ url: `${APP_URL}${sharedWatchPath(createShareToken(row.feedback.id))}` });
}
