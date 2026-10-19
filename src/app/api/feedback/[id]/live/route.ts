import { NextRequest, NextResponse } from "next/server";
import { jsonError, jsonOk, readIdParam } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { makeItLive } from "@/lib/feedback/go-live";

/** "Make it live" on a client's change. The work is makeItLive (lib/feedback/go-live.ts). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Sign in to put this live", 401);
  const id = await readIdParam(params);
  if (id instanceof NextResponse) return id;
  const result = await makeItLive(userId, id);
  return result.ok ? jsonOk({ live: result.live }) : jsonError(result.error, result.status);
}
