import { NextRequest } from "next/server";
import { z, jsonError, jsonOk, readJsonBody } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { verifyFeedbackClaimToken } from "@/lib/feedback/claim-token";
import { claimFeedbackForReporter, getFeedbackForTour } from "@/db/queries/site-feedback";
import { getProjectAccess } from "@/db/queries/project-access";

const Body = z.object({ token: z.string().min(20).max(500) });

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Sign in to track this feedback", 401);
  const body = await readJsonBody(req, Body);
  if (body instanceof Response) return body;
  const feedbackId = verifyFeedbackClaimToken(body.token);
  if (!feedbackId) return jsonError("This tracking link is invalid or expired", 400);
  // Someone who can build this project opening a tracking link: show them
  // the note where Build is one tap, and start nothing. This used to start the
  // build on open, for an owner tracking their own note — but the link is the
  // REPORTER's, so a stranger could send theirs to the owner and have it built
  // by a click on a link. Their claim is left for the person who wrote it.
  const record = await getFeedbackForTour(feedbackId);
  if (!record) return jsonError("Feedback not found", 404);
  const access = await getProjectAccess(userId, record.feedback.projectId);
  if (access?.canEdit) {
    return jsonOk({ claimed: false, owner: true, projectId: record.feedback.projectId });
  }

  const outcome = await claimFeedbackForReporter(feedbackId, userId);
  if (outcome === "missing") return jsonError("Feedback not found", 404);
  if (outcome === "already-claimed")
    return jsonError("This feedback belongs to another account", 409);
  return jsonOk({ claimed: true });
}
