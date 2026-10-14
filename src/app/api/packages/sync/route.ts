import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readJsonBody } from "@/lib/api/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { syncUserPackages } from "@/lib/packages/sync";

const SyncBody = z.object({
  /** Read only this project (one of the caller's). Omit for all of them. */
  projectId: z.uuid().optional(),
  /** Read even repositories whose head commit has not moved. */
  force: z.boolean().optional(),
});

/** At most this many reads a minute per person — each one asks GitHub per project. */
const SYNC_PER_MINUTE = 6;

/**
 * Read what the caller's projects are built from, now. Per-project failures
 * come back as results, never as a failed request: one private repository
 * must not hide what the other twenty are built from.
 */
export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const hasBody = Number(req.headers.get("content-length") ?? "0") > 0;
  const body = hasBody ? await readJsonBody(req, SyncBody) : {};
  if (body instanceof NextResponse) return body;
  if (!checkRateLimit(`packages-sync:${userId}`, SYNC_PER_MINUTE, 60_000)) {
    return jsonError("Read a minute ago — try again shortly.", 429);
  }
  const summary = await syncUserPackages(userId, {
    onlyProjectId: body.projectId,
    force: body.force,
  });
  if (body.projectId && summary.results.length === 0) return jsonError("Project not found", 404);
  return jsonOk({ ...summary });
}
