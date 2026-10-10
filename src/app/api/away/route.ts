import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, jsonOk, jsonError, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { AWAY_MAX_MINUTES, awayLines } from "@/lib/away-rules";
import { clearAway, readAway, setAway, whileYouWereAway } from "@/lib/away";

/**
 * "Back in 30 minutes."
 *   GET    — away / back / none, and when back, what happened since (lines).
 *   POST   — { minutes } — the chat's set_away tool and any button say it here.
 *   DELETE — the card was read; nothing to show next time.
 */
export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const status = await readAway(userId);
  if (status.state !== "back") return jsonOk({ status });
  const summary = await whileYouWereAway(userId, status.since, status.until);
  return jsonOk({ status, summary, lines: awayLines(summary) });
}

const SetBody = z.object({ minutes: z.number().int().min(1).max(AWAY_MAX_MINUTES) });

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const dataOrResp = await readJsonBody(req, SetBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  return jsonOk(await setAway(userId, dataOrResp.minutes));
}

export async function DELETE() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  await clearAway(userId);
  return jsonOk({});
}
