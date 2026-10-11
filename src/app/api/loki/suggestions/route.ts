import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { loadBuildSuggestions } from "@/lib/build-suggestions/load";

/**
 * GET /api/loki/suggestions?offset=N — what this person could build next,
 * ranked from their own projects, reports, goals, notes and OrangeCat demand
 * (src/lib/build-suggestions). `offset` is the refresh button: it rotates the
 * window through everything that qualified.
 */
export async function GET(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const raw = Number(req.nextUrl.searchParams.get("offset") ?? 0);
  const offset = Number.isFinite(raw) ? Math.max(0, Math.min(Math.trunc(raw), 1000)) : 0;
  const { suggestions, total } = await loadBuildSuggestions(userId, { offset });
  return jsonOk({ suggestions, total }, { headers: { "Cache-Control": "no-store" } });
}
