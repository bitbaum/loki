import { denyDemoInHandler } from "@/lib/demo-guard";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readIdParam, readJsonBody, jsonError, jsonOk } from "@/lib/api/route-helpers";
import { getWorkerReview } from "@/db/queries/site-reviews";
import { REVIEW_LIMITS, ReviewWorkerEvent } from "@/lib/inspection/contract";
import { handleReviewWorker } from "@/lib/inspection/worker-handler";

export const maxDuration = 60;
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = await readIdParam(ctx.params);
  if (id instanceof NextResponse) return id;
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return jsonError("Invalid review ticket", 401);
  const row = await getWorkerReview(id, token);
  if (!row) return jsonError("Review ticket expired", 401);
  const demoDenied = await denyDemoInHandler(row.userId, "spend");
  if (demoDenied) return demoDenied;
  const workerId = req.headers.get("x-review-worker");
  if (!z.uuid().safeParse(workerId).success) return jsonError("Invalid worker", 400);
  if (row.workerId && row.workerId !== workerId)
    return jsonError("Another worker owns this review", 409);
  const body = await readJsonBody(req, ReviewWorkerEvent);
  if (body instanceof NextResponse) return body;
  if (body.kind === "checkpoint" && body.workerId !== workerId)
    return jsonError("Worker mismatch", 403);
  if (body.kind !== "checkpoint" && !row.workerId) return jsonError("Claim the review first", 409);
  try {
    const updated = await handleReviewWorker(row, body);
    if (!updated) {
      const current = await getWorkerReview(id, token);
      return jsonOk({
        status: current?.status ?? "stopped",
        accepted: body.kind === "checkpoint" && current?.workerId === workerId,
        mode: row.mode,
        url: row.url,
        paths: row.paths,
        limits: REVIEW_LIMITS,
      });
    }
    return jsonOk({
      status: updated.status,
      accepted: true,
      mode: row.mode,
      url: row.url,
      paths: row.paths,
      limits: REVIEW_LIMITS,
    });
  } catch (error) {
    console.error("[site-review:worker]", error instanceof Error ? error.message : error);
    return jsonError("The review could not save this observation.", 400);
  }
}
