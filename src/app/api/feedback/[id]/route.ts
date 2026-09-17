import { NextRequest, NextResponse } from "next/server";
import { readIdParam, readJsonBody, jsonOk, jsonError, z } from "@/lib/api/route-helpers";
import { getSessionUserId } from "@/lib/session";
import {
  getFeedbackWithProject,
  setFeedbackFeatured,
  setFeedbackStatus,
} from "@/db/queries/site-feedback";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { notifyFeedbackShipped } from "@/lib/feedback/close-loop";

/**
 * Triage a feedback item. NOTE: /api/feedback is excluded from the auth
 * middleware (the public ingest lives there), so the session check below is
 * the ONLY gate on this handler — do not remove it.
 */

const PatchBody = z
  .object({
    // `dispatched` is set by the dispatch flow, not by manual triage.
    status: z
      .enum([FEEDBACK_STATUS.NEW, FEEDBACK_STATUS.RESOLVED, FEEDBACK_STATUS.ARCHIVED])
      .optional(),
    /** Curation for the public "shipped thanks to feedback" strip — resolved
     *  rows only (enforced in the query). */
    featured: z.boolean().optional(),
  })
  .refine((b) => b.status !== undefined || b.featured !== undefined, {
    message: "Nothing to update",
  });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const dataOrResp = await readJsonBody(req, PatchBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const row = await getFeedbackWithProject(userId, idOrResp);
  if (!row) return jsonError("Feedback not found", 404);
  if (!row.canEdit) return jsonError("Only project owners and editors can update feedback", 403);
  const ownerUserId = row.ownerUserId;

  if (dataOrResp.featured !== undefined) {
    const ok = await setFeedbackFeatured(ownerUserId, idOrResp, dataOrResp.featured);
    if (!ok) return jsonError("Not found or not resolved", 404);
    if (dataOrResp.status === undefined) return jsonOk({});
  }

  if (dataOrResp.status !== undefined) {
    const updated = await setFeedbackStatus(ownerUserId, idOrResp, dataOrResp.status);
    if (!updated) return jsonError("Not found", 404);
    // Done = operator confirmed live change. Visitor "shipped" mail rides this
    // path now — not a bare SUCCESS run close (that lied about inject-only).
    if (dataOrResp.status === FEEDBACK_STATUS.RESOLVED) {
      void notifyFeedbackShipped(updated.id);
    }
    return jsonOk({ feedback: updated });
  }
  return jsonOk({});
}
