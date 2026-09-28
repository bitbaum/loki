import { NextRequest } from "next/server";
import { z, jsonError, jsonOk, readJsonBody } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { verifyFeedbackClaimToken } from "@/lib/feedback/claim-token";
import { claimFeedbackForReporter, getFeedbackForTour } from "@/db/queries/site-feedback";
import { getProjectAccess } from "@/db/queries/project-access";
import { implementFeedback } from "@/lib/feedback/implement";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";

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

  // The owner tracking their OWN report has just told Loki who they are — the
  // one thing the anonymous widget could not. Without an owner pass in the
  // phone's browser, an owner's note landed as a stranger's and waited in the
  // inbox for the very person now reading "waiting for the maintainer"
  // (2026-09-28). Claiming it is the Implement click; make it.
  const record = await getFeedbackForTour(feedbackId);
  if (record && record.feedback.status === FEEDBACK_STATUS.NEW) {
    const access = await getProjectAccess(userId, record.feedback.projectId);
    if (access?.canEdit) {
      const started = await implementFeedback(userId, feedbackId).catch(() => null);
      const runId = started && typeof started.body.runId === "string" ? started.body.runId : null;
      return jsonOk({
        claimed: true,
        owner: true,
        building: !!runId,
        projectId: record.feedback.projectId,
        ...(runId ? {} : { note: started?.body.error ?? started?.body.nextAction ?? null }),
      });
    }
  }
  return jsonOk({ claimed: true });
}
