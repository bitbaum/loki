import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, readJsonBody } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { recordSuggestionDecision } from "@/db/queries/suggestion-decisions";
import { SUGGESTION_DECISION } from "@/lib/suggestions/types";

const DecisionBody = z.object({
  suggestionId: z.string().trim().min(1).max(300),
  decision: z.enum([SUGGESTION_DECISION.TAKEN, SUGGESTION_DECISION.DISMISSED]),
  label: z.string().trim().min(1).max(200),
});

/** POST /api/suggestions/decisions — "Do it" or "Not now" on one suggestion. */
export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const body = await readJsonBody(req, DecisionBody);
  if (body instanceof NextResponse) return body;
  const decision = await recordSuggestionDecision(userId, body);
  return jsonOk({ decision }, { status: 201 });
}
