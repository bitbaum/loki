import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { findServerKickoffByName } from "@/lib/kickoff/server-runs";

/**
 * GET /api/projects/kickoff?tab=<project name or key>
 *
 * The Terminal knows a project only by its session name. When someone opens it
 * to watch a kickoff — from another tab, another device, after the phone killed
 * the page — this is how the empty state finds the run to show instead of
 * "No session named …".
 */
export async function GET(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tab = req.nextUrl.searchParams.get("tab")?.trim();
  if (!tab) return NextResponse.json({ error: "tab required" }, { status: 400 });
  return NextResponse.json(
    { ok: true, run: findServerKickoffByName(userId, tab.slice(0, 300)) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
