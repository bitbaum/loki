import { NextRequest, NextResponse } from "next/server";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { rerouteQueuedToCloud } from "@/lib/reroute-queue";

// POST /api/control/reroute  body: { commandId?: string }
// Hand work waiting for this computer to the cloud builder — one row, or
// every unclaimed one. The Control hero's "Run it in the cloud" and the
// feedback card's button both land here.
export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const body = await readJsonBody(req, z.object({ commandId: z.string().uuid().optional() }));
  if (body instanceof NextResponse) return body;
  const result = await rerouteQueuedToCloud(userId, { commandId: body.commandId ?? null });
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonOk({ rerouted: result.rerouted, skipped: result.skipped });
}
