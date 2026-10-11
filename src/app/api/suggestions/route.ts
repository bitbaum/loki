import { jsonError, jsonOk } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { loadSuggestionBoard } from "@/lib/suggestions/load";

/**
 * GET /api/suggestions — the whole board: every avenue's suggestions ranked
 * from this person's own records, minus what they already decided on, plus
 * the momentum counted from those decisions (src/lib/suggestions).
 */
export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const board = await loadSuggestionBoard(userId);
  return jsonOk({ board }, { headers: { "Cache-Control": "no-store" } });
}
