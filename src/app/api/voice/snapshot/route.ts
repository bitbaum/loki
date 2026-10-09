/**
 * GET /api/voice/snapshot — the fleet as no-screen mode reads it. The phone
 * polls this between turns and announces the difference (lib/voice/briefing
 * diffSnapshots), so a run finishing in a pocket is heard within the poll
 * interval without the operator asking.
 */
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { loadFleetSnapshot } from "@/lib/voice/fleet-snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await loadFleetSnapshot(userId));
}
