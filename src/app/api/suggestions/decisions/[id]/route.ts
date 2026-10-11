import { NextResponse } from "next/server";
import { jsonError, jsonOk, readIdParam } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { deleteSuggestionDecision } from "@/db/queries/suggestion-decisions";

/** DELETE /api/suggestions/decisions/:id — undo; the suggestion returns next load. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const id = await readIdParam(ctx.params);
  if (id instanceof NextResponse) return id;
  const gone = await deleteSuggestionDecision(userId, id);
  if (!gone) return jsonError("Not found", 404);
  return jsonOk();
}
