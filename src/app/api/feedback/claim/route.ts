import { NextRequest } from "next/server";
import { z, jsonError, jsonOk, readJsonBody } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { verifyFeedbackClaimToken } from "@/lib/feedback/claim-token";
import { claimFeedbackForReporter } from "@/db/queries/site-feedback";

const Body = z.object({ token: z.string().min(20).max(500) });

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Sign in to track this feedback", 401);
  const body = await readJsonBody(req, Body);
  if (body instanceof Response) return body;
  const feedbackId = verifyFeedbackClaimToken(body.token);
  if (!feedbackId) return jsonError("This tracking link is invalid or expired", 400);
  const outcome = await claimFeedbackForReporter(feedbackId, userId);
  if (outcome === "missing") return jsonError("Feedback not found", 404);
  if (outcome === "already-claimed")
    return jsonError("This feedback belongs to another account", 409);
  return jsonOk({ claimed: true });
}
