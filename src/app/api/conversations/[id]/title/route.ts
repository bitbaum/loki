import { type NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readIdParam } from "@/lib/api/route-helpers";
import { nameThread } from "@/lib/loki/name-thread";

/**
 * POST /api/conversations/[id]/title — name the thread from what it is about.
 * See lib/loki/name-thread.ts; this route is the browser's way to ask.
 *
 * `retry: true` tells the client the thread is still Loki's to name and only
 * the model's reply was unusable — it asks again shortly.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const result = await nameThread(userId, idOrResp);
  if (!result.found) return jsonError("Not found", 404);
  return jsonOk({
    title: result.title,
    changed: result.changed,
    ...(result.retry ? { retry: true } : {}),
  });
}
