import { NextRequest, NextResponse } from "next/server";
import { readIdParam, jsonError } from "@/lib/api/route-helpers";
import { getSessionUserId } from "@/lib/session";
import { getFeedbackWithProject } from "@/db/queries/site-feedback";
import { getOrchestrationRunsByIds } from "@/db/queries/orchestration-runs";
import type { FixShipping } from "@/lib/feedback/fix-shipping";

/**
 * The picture Loki took of the live page to settle this row's shipped fix
 * (feedback/verify-live.ts) — one JPEG data URL. Kept out of the inbox list
 * on purpose; the bytes load only when a card shows them. NOTE: /api/feedback
 * is excluded from the auth middleware (the public ingest lives there), so the
 * session check below is the ONLY gate on this handler — do not remove it.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const row = await getFeedbackWithProject(userId, idOrResp);
  if (!row) return jsonError("Feedback not found", 404);
  const runId = row.feedback.dispatchedRunId;
  if (!runId) return jsonError("No picture", 404);
  const run = (await getOrchestrationRunsByIds(row.ownerUserId, [runId])).get(runId);
  const picture = run?.payload?.fixPicture ?? null;
  const before = run?.payload?.beforePicture ?? null;
  if (!picture && !before) return jsonError("No picture", 404);

  const fix = (run?.payload as { fix?: FixShipping } | undefined)?.fix;
  return NextResponse.json(
    { picture, before, at: fix?.verify?.at ?? null },
    { headers: { "Cache-Control": "private, max-age=3600" } },
  );
}
